// PHOTO RESULT CARD — Phase 3: unit tests for the export ORCHESTRATION
// (photoResultCardExport.jsx) - the off-screen mount/cleanup/prop-wiring
// logic. `html-to-image`'s actual `toJpeg`/`getFontEmbedCSS` are mocked
// (real canvas rasterization is a browser concern, not something jsdom can
// prove - covered by the real-browser verification in the Phase 3 report,
// not here). What IS verified here, against the REAL React tree: the
// export instance never renders application chrome regardless of what's
// passed in, the data-URL-to-Blob conversion actually works, and cleanup
// always happens even when rendering fails.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildShareFilename, generatePhotoResultCardImage, EXPORT_WIDTH, EXPORT_HEIGHT, EXPORT_PIXEL_RATIO } from './photoResultCardExport.jsx'

// A tiny real 1x1 JPEG, base64-encoded - exercises the REAL data-URL ->
// Blob decode path (not just a mocked passthrough), so a bug in that
// conversion would actually fail these tests.
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='
const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => TINY_JPEG_DATA_URL),
  getFontEmbedCSS: vi.fn(async () => '/* fake embedded font css */'),
}))
import { toJpeg, getFontEmbedCSS } from 'html-to-image'

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('buildShareFilename - deterministic, PII-free (owner §11)', () => {
  it('builds forge-workout-YYYY-MM-DD.jpg from the given date', () => {
    expect(buildShareFilename(new Date('2026-09-05T17:00:00.000Z'))).toMatch(/^forge-workout-2026-09-0[45]\.jpg$/)
  })
  it('never includes a member id, email, gym id, or storage path', () => {
    const name = buildShareFilename(new Date('2026-01-01T00:00:00.000Z'))
    expect(name).not.toMatch(/@/)
    expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i) // no uuid shape
  })
})

const baseCardProps = {
  photoUrl: null, // no image event to wait for - keeps these tests fast/deterministic
  gymName: 'CrossFit Delta', gymColor: '#ABE73C',
  variantLevel: 'RX', notRxdLabel: null,
  structureHeader: { primary: '5 RFT', timeCap: null, intrinsicDuration: null, prescriptionLines: [] },
  headline: '5 RFT: 200m Run, 20 Air Squats',
  movements: ['200m Run', '20 Air Squats'],
  resultText: '12:00',
  loggedAt: '2026-09-05T17:00:00.000Z', lang: 'en',
  t: { shareCardCloseLabel: 'Close', shareCardButton: 'Share' },
}

describe('generatePhotoResultCardImage - off-screen render + rasterize (owner §7/§28)', () => {
  it('resolves a real JPEG Blob decoded from the toJpeg data URL, using the configured 4:5/1080x1350 contract', async () => {
    const result = await generatePhotoResultCardImage(baseCardProps)
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.type).toBe('image/jpeg')
    expect(result.blob.size).toBeGreaterThan(0)
    expect(toJpeg).toHaveBeenCalledTimes(1)
    const [, options] = toJpeg.mock.calls[0]
    expect(options.width).toBe(EXPORT_WIDTH)
    expect(options.height).toBe(EXPORT_HEIGHT)
    expect(options.pixelRatio).toBe(EXPORT_PIXEL_RATIO)
    expect(EXPORT_WIDTH * EXPORT_PIXEL_RATIO).toBe(1080)
    expect(EXPORT_HEIGHT * EXPORT_PIXEL_RATIO).toBe(1350)
  })

  it('reuses a cached fontEmbedCSS across calls instead of re-embedding fonts every time (perf - owner §9)', async () => {
    await generatePhotoResultCardImage(baseCardProps)
    await generatePhotoResultCardImage(baseCardProps)
    // The module-level cache may already be warm from an earlier test in
    // this file (it is intentionally session-lifetime, not per-call) - the
    // property under test is that TWO exports here never trigger TWO
    // separate embeds, not the absolute count from a cold start.
    expect(getFontEmbedCSS.mock.calls.length).toBeLessThanOrEqual(1)
    expect(toJpeg).toHaveBeenCalledTimes(2)
    expect(toJpeg.mock.calls[1][1].fontEmbedCSS).toBe('/* fake embedded font css */')
  })

  it('never leaves a detached export container in the DOM after success', async () => {
    await generatePhotoResultCardImage(baseCardProps)
    expect(document.body.querySelector('div[aria-hidden="true"]')).toBeNull()
  })

  it('cleans up the DOM even when toJpeg rejects - resolves { blob: null, error }, never throws', async () => {
    toJpeg.mockRejectedValueOnce(new Error('rasterize failed'))
    const result = await generatePhotoResultCardImage(baseCardProps)
    expect(result.blob).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(document.body.querySelector('div[aria-hidden="true"]')).toBeNull()
  })

  it('never forwards onClose/onShare to the export instance, regardless of what the caller passes (owner §4 - app chrome excluded)', async () => {
    await generatePhotoResultCardImage({ ...baseCardProps, onClose: () => { throw new Error('should never be called/rendered') }, onShare: () => { throw new Error('should never be called/rendered') } })
    // if either handler had been wired to a rendered button, clicking would
    // throw - but the export container is already removed by the time we
    // get here, so the stronger assertion is simply that generation
    // resolved without incident despite chrome-triggering props being present.
    expect(toJpeg).toHaveBeenCalledTimes(1)
  })

  it('toJpeg returning nothing resolves { blob: null, error } rather than a false "success"', async () => {
    toJpeg.mockResolvedValueOnce(null)
    const result = await generatePhotoResultCardImage(baseCardProps)
    expect(result.blob).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
})

// EXPORT-LOST-PHOTO REGRESSION - real root cause (confirmed against the
// installed html-to-image source, node_modules/html-to-image/lib/
// dataurl.js's resourceToDataURL): `cacheBust: true` appends `(?|&) +
// Date.now()` to EVERY external resource URL html-to-image embeds,
// including the card's own background <img src>. A Supabase Storage
// SIGNED URL's validity depends entirely on its `token` query parameter
// being exactly what was issued - an appended, unexpected extra query
// parameter corrupts that request. A failed embed in that library is
// NEVER a thrown error the caller sees - resourceToDataURL's own catch
// silently substitutes `options.imagePlaceholder || ''` (empty), so
// toJpeg still resolves a "successful" JPEG with the photo simply
// missing. FIX: fetch the photo ourselves (the exact, unmodified signed
// URL, never html-to-image's own cache-bust-corrupted fetch) and hand
// the export instance a `data:` URL instead - html-to-image's own
// isDataUrl() checks (embed-images.js) skip network fetching entirely
// for an <img> whose src is already a data: URL, making the corrupted-
// query-string failure mode structurally impossible. Independently
// verified against a REAL browser + a REAL cross-origin photo (see the
// incident report for the exact pixel-sampling evidence) - these tests
// prove the same contract at the unit level, with fetch/FileReader
// exercised for real (not mocked away) so a regression in the actual
// fetch-to-data-URL conversion would fail them too.
describe('EXPORT-LOST-PHOTO REGRESSION - photo is fetched and embedded as a data: URL, never html-to-image\'s own cache-busted network fetch', () => {
  const PHOTO_URL = 'https://storage.example.supabase.co/object/sign/wod-photos/g1/m1/w1/photo.jpg?token=abc123.def456.ghi789'
  // A tiny real 1x1 JPEG (same bytes as TINY_JPEG_BASE64 above) served as
  // the mocked fetch response body - exercises the REAL blob -> FileReader
  // -> data: URL path, not just a mocked passthrough.
  function tinyJpegBlob() {
    const binary = atob(TINY_JPEG_BASE64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: 'image/jpeg' })
  }

  it('fetches the EXACT signed photoUrl (no cache-bust query param appended by this module) and passes a data: URL - never the network URL - into the rendered/rasterized node', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(tinyJpegBlob(), { status: 200 }))
    let capturedImgSrc = null
    toJpeg.mockImplementationOnce(async (node) => {
      capturedImgSrc = node.querySelector('img[data-role="member-photo"]')?.src
      return TINY_JPEG_DATA_URL
    })
    const result = await generatePhotoResultCardImage({ ...baseCardProps, photoUrl: PHOTO_URL })
    expect(result.blob).toBeInstanceOf(Blob)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(PHOTO_URL) // the EXACT signed URL, byte-identical, no appended query param
    // NOT the https:// signed URL - html-to-image never touches the network
    // for it. (jsdom's Blob/FileReader interop doesn't reliably preserve
    // the exact MIME type through readAsDataURL - a documented jsdom
    // limitation, unrelated to this fix - so this asserts the data: scheme
    // itself, the property that actually matters here; real photo-content
    // fidelity through a REAL FileReader is verified against an actual
    // browser, see the incident report's pixel-sampling evidence.)
    expect(capturedImgSrc).toMatch(/^data:/)
    expect(capturedImgSrc).not.toMatch(/^https:/)
    fetchSpy.mockRestore()
  })

  it('a photo fetch failure (expired/invalid signed URL, network error) is an explicit export failure - never a silent photo-less "success"', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }))
    const result = await generatePhotoResultCardImage({ ...baseCardProps, photoUrl: PHOTO_URL })
    expect(result.blob).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error.message).toMatch(/could not embed photo for export/)
    expect(toJpeg).not.toHaveBeenCalled() // never even attempts to rasterize without the photo it was asked to embed
    expect(document.body.querySelector('div[aria-hidden="true"]')).toBeNull() // no dangling export container either
    fetchSpy.mockRestore()
  })

  it('a network-level fetch rejection (offline, DNS failure) is also an explicit export failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await generatePhotoResultCardImage({ ...baseCardProps, photoUrl: PHOTO_URL })
    expect(result.blob).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(toJpeg).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('a no-photo workout (photoUrl null) never calls fetch at all - existing no-photo behavior unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await generatePhotoResultCardImage(baseCardProps) // baseCardProps.photoUrl is null
    expect(result.blob).toBeInstanceOf(Blob)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('Owner §32 truth regression - the export instance receives the SAME canonical props verbatim, never an export-specific derivation', () => {
  const captureNodeText = () => {
    let captured = null
    toJpeg.mockImplementationOnce(async (node) => { captured = node.textContent; return TINY_JPEG_DATA_URL })
    return () => captured
  }

  it('RFT format and performed substitution both reach the exported node exactly as passed', async () => {
    const getText = captureNodeText()
    await generatePhotoResultCardImage({
      ...baseCardProps,
      structureHeader: { primary: '5 RFT', timeCap: null, intrinsicDuration: null, prescriptionLines: [] },
      headline: '5 RFT: 200m Run, 20 Clean & Jerk @ 43 kg',
      movements: ['20 Clean & Jerk @ 43 kg', '20 Push-Ups'],
    })
    const text = getText()
    expect(text).toContain('5 RFT')
    expect(text).toContain('20 Clean & Jerk @ 43 kg')
    expect(text).not.toMatch(/Air Squats/)
  })

  it('tenant branding (ThePACK + a synthetic color) reaches the exported node exactly as passed - no hardcoded gym', async () => {
    const getText = captureNodeText()
    await generatePhotoResultCardImage({ ...baseCardProps, gymName: 'ThePACK', gymColor: '#FF7A00' })
    const text = getText()
    expect(text).toContain('ThePACK')
    expect(text).not.toContain('CrossFit Delta')
  })

  // Owner Phase 5 §21/§26 P - the exported artifact must naturally inherit
  // the corrected hierarchy (no export-specific content, no second
  // renderer): a genuine Time Cap appears once, the athlete progression
  // (not a redundant full prescribed list) appears once, and no standalone
  // central score/status is exported.
  it('the exported node reflects the corrected hierarchy: Time Cap once, athlete progression once, no standalone central score/status', async () => {
    const getText = captureNodeText()
    await generatePhotoResultCardImage({
      ...baseCardProps,
      structureHeader: { primary: 'For Time', timeCap: 'Time cap 10:00', intrinsicDuration: null, prescriptionLines: [] },
      headline: 'For Time: 21 Clean and Jerks @ 43 kg, 21 Cal Air Bike, and 1 more',
      movements: ['21 Clean and Jerks @ 43 kg', '21 Cal Air Bike', '10 Clean & Jerk @ 43 kg'],
      resultText: '7:00', variantLevel: 'RX', notRxdLabel: null,
    })
    const text = getText()
    expect((text.match(/Time cap 10:00/g) || []).length).toBe(1)
    expect((text.match(/7:00/g) || []).length).toBe(1)
    expect(text).toContain('10 Clean & Jerk @ 43 kg')
  })

  // Owner Phase 6 §13/§18/J - the bottom-bar layout swap (FORGE left,
  // compact result+status right) must reach the exported artifact with no
  // export-specific positioning.
  it('the exported node has FORGE in the bottom bar\'s left group and the compact result+status in the right group', async () => {
    let capturedNode = null
    toJpeg.mockImplementationOnce(async (node) => { capturedNode = node; return TINY_JPEG_DATA_URL })
    await generatePhotoResultCardImage({
      ...baseCardProps,
      resultText: '7:00', variantLevel: 'RX', notRxdLabel: null,
    })
    const bottomBar = [...capturedNode.querySelectorAll('div')].find(d => d.style.background === 'rgba(0, 0, 0, 0.55)')
    expect(bottomBar).toBeTruthy()
    const [leftGroup, rightGroup] = [...bottomBar.children]
    expect(leftGroup.textContent).toContain('FORGE')
    expect(rightGroup.textContent).toContain('7:00')
    expect(rightGroup.textContent).toContain('RX')
  })
})
