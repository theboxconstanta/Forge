// PHOTO RESULT CARD — Phase 3: client-side image export. Renders a
// deterministic, viewport-independent instance of the SAME PhotoResultCard
// component (owner §6/§7 - one visual contract, never a second canvas/SVG
// re-implementation of its typography/layout/colors) into an off-screen
// container, waits for its photo + fonts to be ready, and rasterizes it
// with html-to-image - the one new dependency this phase installs (see the
// Phase 3 report for why it was chosen).
//
// Output is fixed at 1080x1350 (4:5) regardless of the caller's current
// viewport width or device pixel ratio (owner §7/§8): a 432x540 CSS-pixel
// render at pixelRatio 2.5 produces exactly that. Generation is 100%
// client-side; nothing is ever uploaded (owner §27) - the Blob exists only
// in memory until the caller hands it to the native Share Sheet or a local
// download.

import { createRoot } from 'react-dom/client'
import { toJpeg, getFontEmbedCSS } from 'html-to-image'
import PhotoResultCard from './PhotoResultCard.jsx'

export const EXPORT_WIDTH = 432
export const EXPORT_HEIGHT = 540 // 4:5
export const EXPORT_PIXEL_RATIO = 2.5 // -> 1080 x 1350 final pixels
export const EXPORT_QUALITY = 0.92
export const EXPORT_MIME_TYPE = 'image/jpeg'

// Bounded wait for the export instance's own member-photo <img> to either
// finish loading or fail, so capture never starts against a still-blank
// image (owner §21) - and never hangs forever if the image event never
// fires for some reason (owner §21 "bounded failure handling").
const IMAGE_READY_TIMEOUT_MS = 4000

// html-to-image's `toBlob` always produces PNG regardless of its own
// `type`/`quality` options (confirmed against the installed v1.11.13
// source - `toBlob` calls the browser's default `canvas.toBlob()` with no
// arguments at all); only `toJpeg` actually honors `quality` and outputs
// JPEG. So this module calls `toJpeg` (a data URL) and converts that to a
// Blob itself, to reliably get the owner's required image/jpeg output
// (owner §10).
// A manual base64 decode (atob + Uint8Array + Blob, all standard browser
// APIs) rather than `fetch(dataUrl)` - fetch's support for the `data:`
// scheme is inconsistent across environments/polyfills, while this path
// works identically everywhere and avoids a needless network-stack round
// trip for bytes that are already in memory.
function dataUrlToBlob(dataUrl) {
  const commaIndex = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, commaIndex)
  const base64 = dataUrl.slice(commaIndex + 1)
  const mimeMatch = header.match(/data:([^;]+);base64/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// EXPORT-LOST-PHOTO REGRESSION - root cause found in html-to-image's own
// installed source (node_modules/html-to-image/lib/dataurl.js,
// resourceToDataURL): given `cacheBust: true` (this module's own toJpeg
// call, below - needed so a NEWER photo never rasterizes from a stale
// cached one), html-to-image appends `(?|&) + Date.now()` to EVERY
// external resource URL it embeds, including the card's own background
// <img src={photoUrl}>, before fetching it itself. A Supabase Storage
// SIGNED URL's validity rests entirely on its `token` query parameter
// being exactly what was issued - appending an extra, unexpected query
// parameter corrupts that signed request. Worse, a failed embed in that
// library is NOT a thrown error the caller ever sees: resourceToDataURL's
// own catch swallows it and substitutes `options.imagePlaceholder || ''`
// (an EMPTY string) - so toJpeg still resolves a "successful" JPEG, just
// with the photo silently missing. Confirmed structurally (not assumed):
// isDataUrl(...) checks throughout embed-images.js SKIP this fetch+
// cache-bust path entirely for an <img> whose `src` is ALREADY a `data:`
// URL - html-to-image reuses it directly, no network request at all.
//
// FIX: fetch the photo ourselves, exactly once, using the EXACT signed
// URL the caller's own already-visible preview `<img>` used (never
// html-to-image's own internal, cache-bust-corrupted fetch), and hand the
// export instance a `data:` URL instead of the network URL - this makes
// the corrupted-query-string failure mode structurally impossible (there
// is no longer a network fetch of the signed URL for html-to-image to
// touch) and is also the "narrowest client-side embedding strategy" the
// mission asked for (no storage/CORS policy change, no public bucket, no
// second permanent copy - the data: URL exists only in memory for this
// one export call). Throws on any failure (network error, non-2xx,
// expired/invalid signed URL, blob-read failure) - the caller must treat
// that as an explicit export failure, never silently proceed without the
// photo (owner invariant - "a photo-fetch/embed failure must not
// masquerade as successful export").
async function fetchPhotoAsDataUrl(photoUrl) {
  const res = await fetch(photoUrl)
  if (!res.ok) throw new Error(`photo fetch failed: HTTP ${res.status}`)
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('photo blob read failed'))
    reader.readAsDataURL(blob)
  })
}

// iOS SHARE EXPORT STILL MISSING PHOTO - the CORS/cache-bust fix above
// (fetchPhotoAsDataUrl) closed one real, confirmed cause of a photo-less
// export, but is NOT the cause of the owner's iPhone-specific failure: the
// photo is already a `data:` URL by the time html-to-image touches it (no
// network fetch involved at all for the actual capture), yet the photo
// still comes out missing on a real iPhone while the exact same code
// produces a correct image in desktop Chrome. This matches a SEPARATE,
// independently well-documented WebKit/Safari limitation of this exact
// SVG-foreignObject-to-canvas rendering technique (html-to-image and its
// predecessor dom-to-image share the same core approach): embedded raster
// images inside a foreignObject are unreliable on the FIRST capture
// attempt in Safari/iOS specifically - confirmed against multiple
// independent third-party reports of the identical symptom ("Image is
// often missing on first render on Safari iOS" - dom-to-image issue #343;
// "with nothing cached, most pieces of the image fail to render... hitting
// refresh... everything renders correctly" - semisignal.com's own testing
// on Safari 14.0.2, where a commenter separately confirms "rendering the
// same page twice in succession" as the working mitigation, the first
// attempt failing silently and the second consistently succeeding). This
// is a genuine WebKit rendering-pipeline quirk, not a size/CORS/timing bug
// this codebase's own code can prevent outright - so the correct response
// is the DOCUMENTED community mitigation (verify + bounded retry) rather
// than assuming the first capture worked.
//
// FIX: after rasterizing, verify the JPEG actually CONTAINS real photo
// content (never trust "toJpeg resolved" alone) by decoding it and
// sampling pixels for genuine color variance - the card's own background/
// scrim, and any white/gray text drawn over it, are all colorless (R≈G≈B)
// at every pixel; a real photo reliably is not, across a wide sampling
// grid. If verification fails, the ENTIRE render+capture is retried once
// (a fresh export instance - matching the documented "second attempt
// succeeds" behavior). If it fails again, this is an explicit export
// failure (owner invariant - never a silently photo-less "success").
// Never touches the approved PhotoResultCard layout, storage policy, or
// RLS - purely a rasterization-reliability safeguard for the SAME
// existing capture path.
const MAX_CAPTURE_ATTEMPTS = 2

async function jpegHasRealPhotoContent(blob) {
  let bitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return false // if we can't even decode it, it certainly doesn't verifiably contain the photo
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    // A wide grid across the whole card - the photo is the card's own
    // full-bleed background (position:absolute, inset:0), so real photo
    // content is reachable from many points regardless of exactly where
    // text/headline/prescription lines happen to sit for this particular
    // result. Requiring color DIVERGENCE (max channel - min channel), not
    // just brightness, is what correctly ignores white/gray text (R≈G≈B
    // regardless of how bright) while still catching real photo content
    // (skin tones, equipment, gym colors reliably have real channel
    // divergence somewhere across a wide grid).
    for (let fx = 0.1; fx <= 0.9; fx += 0.16) {
      for (let fy = 0.06; fy <= 0.94; fy += 0.16) {
        const x = Math.min(canvas.width - 1, Math.floor(canvas.width * fx))
        const y = Math.min(canvas.height - 1, Math.floor(canvas.height * fy))
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
        if (Math.max(r, g, b) - Math.min(r, g, b) > 15) return true
      }
    }
    return false
  } finally {
    bitmap.close?.()
  }
}

// Embedding every @font-face this page can see (owner §20 - fonts must be
// embedded, never skipped, so the export never falls back to a generic
// system font) is the same fixed cost on every single share otherwise -
// computed once per session and reused, per html-to-image's own documented
// getFontEmbedCSS()-reuse pattern, instead of re-fetching/re-embedding the
// bundled Inter subsets on every tap of Share.
let cachedFontEmbedCSSPromise = null
function getSessionFontEmbedCSS(node) {
  if (!cachedFontEmbedCSSPromise) {
    cachedFontEmbedCSSPromise = getFontEmbedCSS(node).catch((error) => {
      cachedFontEmbedCSSPromise = null // let the next call retry rather than sticking with a failed cache forever
      throw error
    })
  }
  return cachedFontEmbedCSSPromise
}

/** Renders `cardProps` (the SAME props the caller's own visible
 * PhotoResultCard already uses) into a fixed-size, off-screen instance and
 * rasterizes it. Resolves `{ blob }` on success or `{ blob: null, error }`
 * on any failure - never throws, never leaves a detached DOM node or a
 * mounted React root behind (owner §28). `onClose`/`onShare` in `cardProps`
 * are ignored - the export instance never renders application chrome
 * (owner §4), regardless of what the visible card currently has wired. */
export async function generatePhotoResultCardImage(cardProps) {
  // EXPORT-LOST-PHOTO REGRESSION - resolve the photo to a `data:` URL
  // BEFORE any DOM work, using the EXACT signed URL the caller's own
  // preview already used (see fetchPhotoAsDataUrl's own header comment
  // for the full root-cause trace). A photo that was expected but cannot
  // be embedded is an explicit export failure, returned here immediately
  // - never a silently photo-less "success" (owner invariant).
  let resolvedPhotoUrl = cardProps.photoUrl || null
  if (cardProps.photoUrl) {
    try {
      resolvedPhotoUrl = await fetchPhotoAsDataUrl(cardProps.photoUrl)
    } catch (error) {
      console.error(error)
      return { blob: null, error: new Error(`could not embed photo for export: ${error.message}`) }
    }
  }
  // One full render-and-rasterize attempt: fresh off-screen container,
  // fresh React root, fresh toJpeg call. Returns { blob } or
  // { blob: null, error }, and always cleans up its own DOM/root before
  // returning - never leaves anything mounted between attempts.
  const captureOnce = async () => {
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.top = '0'
    container.style.left = '-99999px'
    container.style.width = `${EXPORT_WIDTH}px`
    container.style.pointerEvents = 'none'
    container.setAttribute('aria-hidden', 'true')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await new Promise((resolve) => {
        root.render(
          <PhotoResultCard
            {...cardProps}
            photoUrl={resolvedPhotoUrl}
            exportMode
            onClose={undefined}
            onShare={undefined}
            onPhotoError={() => {}}
          />
        )
        // React's createRoot commit happens asynchronously relative to this
        // call - wait for the instance to actually mount before checking
        // anything about its photo <img>, or a fast (no-photo) path here
        // could race ahead of the very first commit. The photo <img> src is
        // now a `data:` URL (resolved above) - this settles near-instantly,
        // kept as defense-in-depth rather than the primary readiness gate.
        const start = Date.now()
        const check = () => {
          if (!container.firstElementChild) {
            if (Date.now() - start > IMAGE_READY_TIMEOUT_MS) { resolve(); return }
            requestAnimationFrame(check); return
          }
          if (!resolvedPhotoUrl) { resolve(); return } // no photo to wait for
          const img = container.querySelector('img[data-role="member-photo"]')
          if (img?.complete) { resolve(); return }
          if (Date.now() - start > IMAGE_READY_TIMEOUT_MS) { resolve(); return }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })
      if (document.fonts?.ready) {
        try { await document.fonts.ready } catch { /* best-effort only */ }
      }
      const cardNode = container.firstElementChild
      if (!cardNode) return { blob: null, error: new Error('export card did not mount') }
      let fontEmbedCSS
      try { fontEmbedCSS = await getSessionFontEmbedCSS(cardNode) } catch { /* fall through without a cached CSS - toJpeg will embed inline itself */ }
      const dataUrl = await toJpeg(cardNode, {
        width: EXPORT_WIDTH, height: EXPORT_HEIGHT,
        pixelRatio: EXPORT_PIXEL_RATIO,
        quality: EXPORT_QUALITY,
        backgroundColor: '#0E0E0E',
        cacheBust: true,
        ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
      })
      if (!dataUrl) return { blob: null, error: new Error('toJpeg returned no data') }
      const blob = await dataUrlToBlob(dataUrl)
      if (!blob) return { blob: null, error: new Error('data URL to Blob conversion failed') }
      return { blob }
    } catch (error) {
      return { blob: null, error }
    } finally {
      root.unmount()
      container.remove()
    }
  }

  // iOS SHARE EXPORT STILL MISSING PHOTO - verify + bounded retry (see the
  // header comment above jpegHasRealPhotoContent for the full evidence
  // trail). Only exercised when a photo was actually expected AND the
  // capture itself otherwise succeeded (produced a real blob) - a
  // genuine capture failure (toJpeg rejecting outright, no DOM mount,
  // etc.) is a DIFFERENT failure class than "rendered successfully but
  // the embedded photo didn't paint" and is returned immediately,
  // unretried, exactly as before this fix. A no-photo capture also never
  // enters the retry loop - nothing to verify, single attempt, unchanged.
  const firstResult = await captureOnce()
  if (!firstResult.blob || !resolvedPhotoUrl) return firstResult
  let lastResult = firstResult
  for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt++) {
    let containsPhoto
    try { containsPhoto = await jpegHasRealPhotoContent(lastResult.blob) } catch { containsPhoto = true } // verification itself failing must never block an otherwise-successful export
    if (containsPhoto) return lastResult
    console.error(new Error(`generatePhotoResultCardImage: attempt ${attempt} produced a photo-less JPEG despite a photo being expected`))
    if (attempt === MAX_CAPTURE_ATTEMPTS) break
    lastResult = await captureOnce()
    if (!lastResult.blob) break // the retry itself failed outright - fall through to the fail-closed return below
  }
  // Every attempt either failed outright on retry or produced a verifiably
  // photo-less image - fail closed rather than hand back a "successful"
  // JPEG missing the one thing the member chose to share (owner invariant).
  return { blob: null, error: lastResult.error || new Error('exported image did not contain the photo after retrying') }
}

/** Deterministic, PII-free filename (owner §11) - a date is sufficient,
 * never a member id/email/gym id/storage path. Pure. */
export function buildShareFilename(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `forge-workout-${y}-${m}-${d}.jpg`
}
