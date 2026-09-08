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

import { useEffect, useRef, useState } from 'react'
import { MapPin, Calendar, Clock, X, Share2 } from 'lucide-react'
import { localeFor } from './utils'

// LONG PRESS ON PHOTO DOES NOT TRIGGER SHARE - a ~2s hold on the card must
// invoke the SAME canonical `onShare` action as the existing top-right
// button (never a second export/share implementation). Tuned to tolerate
// normal finger micro-jitter (owner §5) while still cancelling on an
// actual scroll/drag (owner §6) - see the gesture handlers below for the
// full contract.
const LONG_PRESS_MS = 2000
const LONG_PRESS_MOVE_CANCEL_PX = 12
// iOS SAFARI USER-ACTIVATION CONSTRAINT (owner §7) - calling
// navigator.share() directly from this timer's callback would NOT be a
// direct result of the user's tap: transient (user) activation is a
// short, browser-internal timer WebKit's own engineering blog describes
// as "a few seconds" that explicitly does not survive an async gap like
// `setTimeout` reliably reaching an await'd API - this is the same,
// widely-documented restriction behind "you can't open a popup from
// setTimeout" (WebKit blog "The User Activation API"; W3C Web Share API
// spec section on transient activation; Mozilla bug 1643205 "Navigator's
// share() must consume user activation"). No real iPhone was available in
// this session to empirically confirm the failure, but this is
// established, citable cross-engine platform behavior, not a guess - so a
// direct delayed `onShare()` call from the 2s timer risks silently
// downgrading every long-press share to a local file download (the
// existing, always-safe fallback already built into
// shareGeneratedImageBlob) instead of the real native Share Sheet the
// owner asked for. FIX: the completed long press reveals a small
// contextual "Share" chip instead of calling onShare itself - the user's
// OWN tap on that chip is a fresh, direct user gesture, so it reaches the
// exact same canonical `onShare` handler the top-right button already
// uses, under activation guaranteed valid on every engine (matching the
// already-live-verified button path, bd8ede1).
const SHARE_CHIP_AUTO_HIDE_MS = 4000

export default function PhotoResultCard({
  photoUrl, onPhotoError,
  gymName, gymColor,
  variantLevel, notRxdLabel,
  structureHeader, // { primary, secondary, prescriptionLines } | null - resolveWorkoutStructureHeader (workoutFormats.js)
  headline, // string | null - composeWorkoutHeadline (workoutFormats.js), the top-of-card summary
  movements, resultText, loggedAt, lang, t,
  // CANONICAL STRENGTH RESULT INTELLIGENCE Phase F - two OPTIONAL, already-
  // computed-by-the-caller facts (never derived here - same "pure
  // presentation" contract as every other prop on this component).
  // `volumeText` - a compact pre-formatted string (e.g. "1,966kg total",
  // WorkoutSharePopup/JurnalList's own computeVolumeLoad-derived value) or
  // null when this Result isn't volume-eligible / nothing was logged.
  // `isNewPr` - boolean, true only when the caller found a valid,
  // source-linked pr_events row for this exact log (never inferred here
  // from resultText/load - explicit-RM-intent gating happens entirely in
  // the caller, via the authoritative ledger). When both happen to be
  // true (not possible under today's eligibility - Build to Heavy/1RM is
  // never volume-eligible - but not assumed to stay that way forever), the
  // PR line takes priority in this single compact secondary slot.
  volumeText, isNewPr,
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

  // LONG PRESS ON PHOTO DOES NOT TRIGGER SHARE - gesture state. Refs (not
  // state) for anything read/written inside the timer/pointer callbacks
  // themselves, so cancelling on movement/release never waits on a
  // re-render; `shareChipVisible` is the one piece that actually needs to
  // re-render (it drives the chip's presence in the tree).
  const [shareChipVisible, setShareChipVisible] = useState(false)
  const pressTimerRef = useRef(null)
  const chipHideTimerRef = useRef(null)
  const startPosRef = useRef(null)
  const longPressFiredRef = useRef(false)

  const cancelPressTimer = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null }
  }
  // Cleans up both timers on unmount (owner §8J) - a card that closes/
  // unmounts mid-hold must never fire a share afterwards, and a card that
  // unmounts while the chip is showing must never leak its auto-hide timer.
  useEffect(() => () => { cancelPressTimer(); clearTimeout(chipHideTimerRef.current) }, [])

  // pointerdown - starts the hold timer. A NEW gesture anywhere on the card
  // also dismisses any already-showing chip from a PRIOR long press (owner
  // §5 "tap elsewhere to dismiss"), and normal (short) taps are left
  // completely alone - nothing here prevents/stops the browser's own click,
  // so the existing tap-to-toggle Journal behavior keeps working exactly as
  // before (owner §2 "normal tap: no unwanted expand/collapse").
  const handlePressStart = (e) => {
    if (!onShare) return
    if (shareChipVisible) setShareChipVisible(false)
    longPressFiredRef.current = false
    startPosRef.current = { x: e.clientX, y: e.clientY }
    cancelPressTimer()
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null
      longPressFiredRef.current = true
      setShareChipVisible(true)
      clearTimeout(chipHideTimerRef.current)
      chipHideTimerRef.current = setTimeout(() => setShareChipVisible(false), SHARE_CHIP_AUTO_HIDE_MS)
    }, LONG_PRESS_MS)
  }
  // pointermove - only intentional movement (a real scroll/drag) cancels
  // the hold (owner §6E); tiny finger jitter well under the threshold must
  // never invalidate an otherwise-still hold (owner §5D).
  const handlePressMove = (e) => {
    if (!pressTimerRef.current || !startPosRef.current) return
    const dx = e.clientX - startPosRef.current.x
    const dy = e.clientY - startPosRef.current.y
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_CANCEL_PX) cancelPressTimer()
  }
  // pointerup/pointercancel - releasing before 2s (or an actual cancel)
  // simply stops the timer; nothing else to undo since a not-yet-fired
  // hold never touched the DOM/state.
  const handlePressEnd = () => { cancelPressTimer() }
  // The browser's own click (real mouse click, or the compatibility click
  // synthesized after a touch release) is the only reliable cross-engine
  // point to suppress "release after a completed hold" (owner §4/§8C) -
  // pointerup's own preventDefault() is not consistently honored for this
  // across engines, so this capture-phase check is the actual guarantee:
  // it runs BEFORE the click can reach the Share/Close buttons' own
  // onClick or bubble out to Journal's outer toggleClosed (owner §4/§8I).
  // A normal completed tap (never held 2s) leaves longPressFiredRef false,
  // so this is a no-op for every ordinary click.
  const handleClickCapture = (e) => {
    if (!longPressFiredRef.current) return
    longPressFiredRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      onPointerDown={handlePressStart} onPointerMove={handlePressMove}
      onPointerUp={handlePressEnd} onPointerCancel={handlePressEnd}
      onClickCapture={handleClickCapture}
      onContextMenu={(e) => { if (onShare) e.preventDefault() }}
      style={{
        position: 'relative', width: '100%', aspectRatio: '4 / 5', maxHeight: exportMode ? 'none' : '80vh', borderRadius: '16px', overflow: 'hidden', background: '#0E0E0E',
        // Suppress iOS's native image callout (save/copy) and text
        // selection ONLY on this card surface (owner §6 "do not suppress
        // native browser behavior globally") - `pan-y` keeps normal
        // vertical scrolling of the surrounding Journal list working, our
        // own JS threshold above is what actually distinguishes an
        // intentional scroll/drag from a still hold.
        touchAction: onShare ? 'pan-y' : undefined,
        WebkitTouchCallout: onShare ? 'none' : undefined,
        WebkitUserSelect: onShare ? 'none' : undefined,
        userSelect: onShare ? 'none' : undefined,
      }}>
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
          buttons, never redesigning the card to fit a large action.
          JOURNAL CLICK-TO-EXPAND DUPLICATION FIX (3rd pass, section 6/9G)
          - stopPropagation on both: this card is sometimes embedded
          inside another element that ALSO has its own onClick (Journal's
          outer card wrapper toggles collapsed/expanded on any click
          inside it) - without this, tapping Share/Close bubbles up and
          fires that OUTER handler too, e.g. collapsing the Journal entry
          in the same tap as sharing it. WorkoutSharePopup's own usage is
          unaffected either way (its inner content div already stops
          propagation before its backdrop's onClose) - this is a no-op
          there, but the only protection Journal's usage has. */}
      <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {onShare && (
          <button onClick={(e) => { e.stopPropagation(); onShare(e) }} aria-label={t.shareCardButton} disabled={!!sharePending}
            style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: sharePending ? 'default' : 'pointer', opacity: sharePending ? 0.55 : 1 }}>
            <Share2 size={13} strokeWidth={2.25} />
          </button>
        )}
        {onClose && (
          <button onClick={(e) => { e.stopPropagation(); onClose(e) }} aria-label={t.shareCardCloseLabel}
            style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
            <X size={14} strokeWidth={2.25} />
          </button>
        )}
      </div>

      {/* LONG PRESS ON PHOTO DOES NOT TRIGGER SHARE - the completed-hold
          contextual chip (owner §7 fallback). Tapping it is a fresh,
          direct user gesture that calls the exact same `onShare` the
          top-right button already uses - stopPropagation for the same
          reason as that button (never let this tap also bubble into
          Journal's outer toggleClosed). Its OWN pointerdown must also
          never reach the root's gesture handler above: that handler
          dismisses/restarts on every new press so a stale chip from a
          PRIOR hold doesn't linger under a later, unrelated tap - without
          this stopPropagation, touching the chip to actually tap it would
          hide the chip (and cancel this same tap) out from under the
          user's own finger before the click ever fires. */}
      {onShare && shareChipVisible && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setShareChipVisible(false); onShare(e) }}
          aria-label={t.shareCardButton} disabled={!!sharePending} data-role="long-press-share-chip"
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 3,
            display: 'flex', alignItems: 'center', gap: '7px',
            background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: '999px',
            padding: '11px 20px', color: '#fff', fontSize: '13px', fontWeight: '700',
            cursor: sharePending ? 'default' : 'pointer', opacity: sharePending ? 0.55 : 1,
          }}>
          <Share2 size={15} strokeWidth={2.25} />
          {t.shareCardButton}
        </button>
      )}

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '16px 38px 46px 14px', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
        {/* 1. TOP WORKOUT SUMMARY - condensed/bold/uppercase/white/left,
            never centered (owner §7/§9). Context, not the hero element -
            deliberately smaller than the central format/progression below
            it (owner Phase 5 §2 correction: the prior size made this too
            visually dominant). */}
        {headline && (
          <div style={{ fontSize: 'clamp(11px, 3vw, 13px)', fontWeight: '800', color: '#fff', lineHeight: 1.25, letterSpacing: '-0.005em', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
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
          {/* Owner Phase 5 - CENTER answers "what did the athlete actually
              do?" ONLY. This is the SAME resolveResultMovementLines output
              Leaderboard's own expanded card renders as `cardMovementLines`
              (App.jsx) - one canonical athlete-performance representation,
              never a PhotoResultCard-specific reinterpretation. The
              standalone score/status row and the separate full-workout
              block that used to sit here are both REMOVED - score+status
              now live exactly once, in the bottom bar only (owner §11/§13:
              "status must appear once", "no piece of information
              duplicated"). */}
          {movements && movements.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '13px', fontWeight: '700', lineHeight: 1.35, color: '#fff', textTransform: 'uppercase' }}>
              {movements.map((m, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>{m}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* Bottom translucent bar - overlays the photo, not a footer outside
          it (owner §23/§26). Owner Phase 6 final polish: FORGE moved to the
          left (application/product branding, secondary), the athlete's
          compact final result + status moved to the right (primary
          information in this bar, right-aligned). `resultText` here is
          ALREADY guaranteed compact by the caller (resolveCompactResultText,
          workoutFormats.js) - this component itself never inspects or
          truncates it, it only lays out whatever compact string (or null)
          it is given next to `statusText`. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '9px 12px', background: 'rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <img src="/forge.png" alt="" data-role="forge-logo" style={{ height: '16px', width: '16px', borderRadius: '4px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '11px', letterSpacing: '1px' }}>FORGE</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, fontSize: '11px', fontWeight: '700', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
            {[resultText, statusText].filter(Boolean).join(' | ')}
          </div>
          {/* CANONICAL STRENGTH RESULT INTELLIGENCE Phase F - a single
              compact secondary line, never replacing the primary result/
              status line above it (owner "preserve the current bottom-right
              primary result", "compact secondary value without changing
              the established visual hierarchy"). PR takes priority over
              volume in this one slot when both happen to be present. */}
          {(isNewPr || volumeText) && (
            <div style={{ fontSize: '10px', fontWeight: '700', color: accent, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {isNewPr ? `🏆 ${t?.strengthNewPrLabel || 'NEW P.R.'}` : volumeText}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
