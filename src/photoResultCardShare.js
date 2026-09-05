// PHOTO RESULT CARD — Phase 3: share orchestration (owner §12-16). Pure
// logic, no React/JSX - drives the native-file-share -> download ->
// text-fallback hierarchy the owner requires. Never throws - always
// resolves an outcome tag the caller (App.jsx) uses to pick the right
// toast/translation, never a raw error reaching the UI.
//
// `generateImage`, `share`, `canShare` are all injectable (default to the
// real `generatePhotoResultCardImage`/`navigator.share`/`navigator.canShare`)
// so this orchestration - the actual decision tree - is unit-testable
// without a real canvas/html-to-image/Web Share API (none of which jsdom
// can run) - the same injection pattern Phase 1's attachWodLogPhoto/
// processFile already established for this codebase.

import { generatePhotoResultCardImage } from './photoResultCardExport.jsx'

/** Best-effort local download of an already-generated Blob (owner §14
 * tier B - "file sharing unsupported but image generation works"). Never
 * throws. Revokes its object URL shortly after triggering the download. */
function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}

/** Given an already-generated image Blob, attempts the native file Share
 * Sheet, falling back to a local download if file-sharing isn't supported
 * or the share attempt itself fails for a reason other than the user
 * cancelling. Resolves one of:
 *  - { outcome: 'shared' }       - native Share Sheet completed
 *  - { outcome: 'cancelled' }    - user dismissed the Share Sheet (owner
 *                                  §16 - never treated as an error)
 *  - { outcome: 'downloaded' }   - saved locally instead
 *  - { outcome: 'download-failed' } - even the download fallback failed
 * Never throws. */
export async function shareGeneratedImageBlob({
  blob, filename, shareText,
  share = (typeof navigator !== 'undefined' ? navigator.share?.bind(navigator) : undefined),
  canShare = (typeof navigator !== 'undefined' ? navigator.canShare?.bind(navigator) : undefined),
}) {
  let file
  try {
    file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
  } catch (error) {
    console.error(error)
    return { outcome: downloadBlob(blob, filename) ? 'downloaded' : 'download-failed' }
  }
  const supportsFileShare = typeof share === 'function' && typeof canShare === 'function' && (() => {
    try { return !!canShare({ files: [file] }) } catch { return false }
  })()
  if (supportsFileShare) {
    try {
      await share({ files: [file], text: shareText })
      return { outcome: 'shared' }
    } catch (error) {
      if (error?.name === 'AbortError') return { outcome: 'cancelled' }
      // Any other share() failure still has a valid, already-generated
      // image - fall through to the download fallback rather than giving
      // up (owner §14 - "do not leave the user with a dead Share button").
    }
  }
  return { outcome: downloadBlob(blob, filename) ? 'downloaded' : 'download-failed' }
}

/** Top-level orchestration (owner §15 state machine): generate the image,
 * then hand it to shareGeneratedImageBlob - or, if generation itself
 * fails, invoke the caller's EXISTING text-share/clipboard fallback
 * (owner §14 tier C) rather than reimplementing it here. Never throws. */
export async function sharePhotoResultCardImage({
  cardProps, filename, shareText,
  generateImage = generatePhotoResultCardImage,
  onTextFallback,
  ...shareOverrides
}) {
  const { blob, error } = await generateImage(cardProps)
  if (!blob) {
    if (typeof onTextFallback === 'function') {
      try { await onTextFallback() } catch (e) { console.error(e) }
    }
    return { outcome: 'render-failed', error }
  }
  return shareGeneratedImageBlob({ blob, filename, shareText, ...shareOverrides })
}
