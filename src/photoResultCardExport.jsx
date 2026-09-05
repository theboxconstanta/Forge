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
          exportMode
          onClose={undefined}
          onShare={undefined}
          onPhotoError={() => {}}
        />
      )
      // React's createRoot commit happens asynchronously relative to this
      // call - wait for the instance to actually mount before checking
      // anything about its photo <img>, or a fast (no-photo) path here
      // could race ahead of the very first commit.
      const start = Date.now()
      const check = () => {
        if (!container.firstElementChild) {
          if (Date.now() - start > IMAGE_READY_TIMEOUT_MS) { resolve(); return }
          requestAnimationFrame(check); return
        }
        if (!cardProps.photoUrl) { resolve(); return } // no photo to wait for
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
    console.error(error)
    return { blob: null, error }
  } finally {
    root.unmount()
    container.remove()
  }
}

/** Deterministic, PII-free filename (owner §11) - a date is sufficient,
 * never a member id/email/gym id/storage path. Pure. */
export function buildShareFilename(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `forge-workout-${y}-${m}-${d}.jpg`
}
