// PHOTO RESULT / SHARE CARD — Phase 2.4 (owner-approved pixel-faithful
// visual contract): one continuous photo-backed result composition, no
// separate header/footer chrome. Reused verbatim by the post-save share
// popup (WorkoutSharePopup) and the Journal's expanded log card - only the
// actual card visual is shared, never the surrounding modal/inline chrome.
//
// Pure presentation only: every piece of result truth (movements, score,
// variant, Modified/Not RX'd label, workout structure) is computed by the
// CALLER from already-canonical sources (resolveResultMovementLines,
// resolveWorkoutStructureHeader, composeWorkoutHeadline, etc. -
// workoutFormats.js / resultWorkoutLines.js) - this component never
// re-derives any of it, never reads wod_logs/wods, never imports scoring/
// prescription/workout-format code, never parses a result or movement
// string itself. `resultText`/movement lines are presented in UPPERCASE via
// CSS `textTransform` only - the actual strings passed in are never
// mutated.
//
// The MEMBER'S OWN uploaded photo is the ONLY background this component
// ever renders - there is no static/reference image, nothing bundled,
// nothing baked into the stored JPEG. The dark treatment is a CSS overlay
// only (a flat tint + a top/bottom gradient) - never `filter: grayscale`/
// `saturate(0)`, so the athlete's original color photo always shows
// through underneath.
//
// `photoUrl` null means "still loading" (renders a skeleton in the photo's
// place while a signed-URL request is in flight) - the caller decides
// whether to mount this component at all (only once a photo is known to
// exist); an <img> load failure calls `onPhotoError` so the caller can fall
// back to its own plain, no-photo layout.
//
// `onShare` is OPTIONAL - only the post-save popup has an existing Share
// action to preserve; Journal reuses the exact same component without it
// (it never had one before). Per the owner's Phase 2.4 correction, Close
// and Share are minimal floating icon buttons ("application chrome"), never
// a large button baked into the card composition.
//
// PHOTO RESULT CARD Phase 3 - `exportMode` is the ONLY prop that changes
// this component's own layout, and only to remove the `max-height: 80vh`
// viewport-relative cap (photoResultCardExport.js renders an off-screen
// instance at a FIXED 432x540 CSS-pixel size, so nothing here should ever
// be clamped by the executing browser's actual window height - owner §7).
// The export helper never passes onClose/onShare, so this same component,
// with the same conditional rendering already in place, naturally excludes
// all application chrome from the exported image (owner §4) - no separate
// export-only markup branch exists.

import { MapPin, Calendar, Clock, X, Share2 } from 'lucide-react'
import { localeFor } from './utils'

export default function PhotoResultCard({
  photoUrl, onPhotoError,
  gymName, gymColor,
  variantLevel, notRxdLabel,
  structureHeader, // { primary, secondary, prescriptionLines } | null - resolveWorkoutStructureHeader (workoutFormats.js)
  headline, // string | null - composeWorkoutHeadline (workoutFormats.js), the top-of-card summary
  movements, resultText, loggedAt, lang, t,
  onShare, sharePending,
  onClose,
  exportMode,
}) {
  const dateObj = loggedAt ? new Date(loggedAt) : null
  const accent = gymColor || '#ABE73C'
  // Owner §17/§24 - the compact "score | status" slot shows ONE status word:
  // the more specific Modified/Not RX'd fact when it applies, otherwise the
  // selected variant. Both facts remain available to the caller as separate
  // props/axes - this is only how ONE particular compact display picks
  // between them, not a collapse of the underlying axes.
  const statusText = notRxdLabel || variantLevel || null
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 5', maxHeight: exportMode ? 'none' : '80vh', borderRadius: '16px', overflow: 'hidden', background: '#0E0E0E' }}>
      {photoUrl ? (
        <img src={photoUrl} alt="" onError={onPhotoError} data-role="member-photo"
          crossOrigin={exportMode ? 'anonymous' : undefined}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: '#1c1c1c' }} />
      )}
      {/* Dark scrim - CSS overlay only, never grayscale/desaturate (owner
          §4/§29/§43): the member's original color photo always shows
          through underneath. Stronger than the prior version per the
          owner's explicit "significantly darker" correction. */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.42)' }} />
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.28) 40%, rgba(0,0,0,0.55) 75%, rgba(0,0,0,0.82) 100%)' }} />

      {/* Close/Share - application chrome, not part of the visual result
          composition itself (owner §35/§36) - minimal floating icon
          buttons, never redesigning the card to fit a large action. */}
      <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {onShare && (
          <button onClick={onShare} aria-label={t.shareCardButton} disabled={!!sharePending}
            style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: sharePending ? 'default' : 'pointer', opacity: sharePending ? 0.55 : 1 }}>
            <Share2 size={13} strokeWidth={2.25} />
          </button>
        )}
        {onClose && (
          <button onClick={onClose} aria-label={t.shareCardCloseLabel}
            style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
            <X size={14} strokeWidth={2.25} />
          </button>
        )}
      </div>

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '16px 38px 46px 14px', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
        {/* 1. TOP WORKOUT SUMMARY - condensed/bold/uppercase/white/left,
            never centered (owner §7/§9). */}
        {headline && (
          <div style={{ fontSize: 'clamp(15px, 4.2vw, 19px)', fontWeight: '800', color: '#fff', lineHeight: 1.15, letterSpacing: '-0.01em', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
            {headline}
          </div>
        )}

        {/* 1b. TOP SECONDARY - a genuine Time Cap only (owner's universal
            hierarchy: For Time/RFT/Chipper/Ladder/Partner WOD via
            resolveWorkoutStructureHeader's own `timeCap` field). Never
            shown for an intrinsic-duration format (AMRAP/EMOM/Intervals),
            and never also repeated in the center format label below -
            exactly one place on the card ever shows it. */}
        {structureHeader?.timeCap && (
          <div style={{ marginTop: '2px', fontSize: '12px', fontWeight: '700', color: '#fff', textTransform: 'uppercase' }}>
            {structureHeader.timeCap}
          </div>
        )}

        {/* 2. Thin divider (owner §10) */}
        <div aria-hidden="true" style={{ height: '1px', background: 'rgba(255,255,255,0.35)', margin: '10px 0 8px', width: '90%' }} />

        {/* 3. Metadata row - gym / date / time, existing lucide icons, never
            emoji (owner §11/§12). */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', fontSize: '11px', fontWeight: '700', color: '#fff' }}>
          {gymName && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              <MapPin size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gymName}</span>
            </span>
          )}
          {dateObj && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <Calendar size={11} strokeWidth={2.25} />
              {dateObj.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
          {dateObj && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <Clock size={11} strokeWidth={2.25} />
              {dateObj.toLocaleTimeString(localeFor(lang), { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* 4/5/6. Central block - pushed toward the lower-middle of the
            photo regardless of how much content sits above it, leaving
            deliberate breathing room (owner §17/§22/§33). */}
        <div style={{ marginTop: 'auto' }}>
          {structureHeader && (
            <div style={{ marginBottom: structureHeader.prescriptionLines.length ? '2px' : '4px' }}>
              <span style={{ fontSize: 'clamp(26px, 9vw, 38px)', fontWeight: '800', color: accent, lineHeight: 1, letterSpacing: '-0.02em', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
                {structureHeader.primary}
              </span>
              {structureHeader.intrinsicDuration && (
                <span style={{ fontSize: 'clamp(14px, 4vw, 18px)', fontWeight: '800', color: accent, marginLeft: '8px', textTransform: 'uppercase' }}>
                  {structureHeader.intrinsicDuration}
                </span>
              )}
            </div>
          )}
          {structureHeader?.prescriptionLines.map((l, i) => (
            <div key={i} style={{ fontSize: '13px', fontWeight: '700', color: '#fff', textTransform: 'uppercase', marginBottom: '4px' }}>{l}</div>
          ))}
          {(resultText || statusText) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: movements?.length ? '10px' : '0' }}>
              {resultText && (
                <span style={{ fontSize: 'clamp(16px, 5vw, 21px)', fontWeight: '800', color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>
                  {resultText}
                </span>
              )}
              {statusText && (
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#fff', border: '1px solid rgba(255,255,255,0.55)', borderRadius: '4px', padding: '2px 7px', lineHeight: 1.2, textTransform: 'uppercase' }}>
                  {statusText}
                </span>
              )}
            </div>
          )}
          {movements && movements.length > 0 && (
            <div style={{ fontSize: '12px', fontWeight: '700', lineHeight: 1.3, color: '#fff', textTransform: 'uppercase' }}>
              {movements.map((m, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>{m}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* Bottom translucent bar - overlays the photo, not a footer outside
          it (owner §23/§26). */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '9px 12px', background: 'rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, fontSize: '11px', fontWeight: '700', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[resultText, statusText].filter(Boolean).join(' | ')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <img src="/forge.png" alt="" data-role="forge-logo" style={{ height: '16px', width: '16px', borderRadius: '4px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '11px', letterSpacing: '1px' }}>FORGE</span>
        </div>
      </div>
    </div>
  )
}
