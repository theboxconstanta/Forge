// PHOTO RESULT CARD — Phase 3: unit tests for the share ORCHESTRATION
// (photoResultCardShare.js) - the actual decision tree required by the
// owner's Phase 3 contract (native file share -> download -> text
// fallback, cancellation handling, double-tap protection lives in App.jsx
// and is covered separately). jsdom cannot run html-to-image/canvas/the
// real Web Share API, so `generateImage`/`share`/`canShare` are injected
// here - the same pattern Phase 1 established for attachWodLogPhoto's
// injectable `processFile`.

import { describe, it, expect, vi } from 'vitest'
import { shareGeneratedImageBlob, sharePhotoResultCardImage } from './photoResultCardShare.js'

const fakeBlob = () => ({ size: 1234, type: 'image/jpeg' })

describe('shareGeneratedImageBlob - native file share -> download fallback hierarchy (owner §12/§14)', () => {
  it('supported + canShare true: calls navigator.share with the file and text, resolves "shared"', async () => {
    const share = vi.fn(async () => {})
    const canShare = vi.fn(() => true)
    const result = await shareGeneratedImageBlob({ blob: fakeBlob(), filename: 'forge-workout-2026-09-05.jpg', shareText: 'CrossFit Delta · FORGE', share, canShare })
    expect(result).toEqual({ outcome: 'shared' })
    expect(share).toHaveBeenCalledTimes(1)
    const arg = share.mock.calls[0][0]
    expect(arg.files).toHaveLength(1)
    expect(arg.files[0].name).toBe('forge-workout-2026-09-05.jpg')
    expect(arg.files[0].type).toBe('image/jpeg')
    expect(arg.text).toBe('CrossFit Delta · FORGE')
  })

  it('user cancels the native Share Sheet (AbortError): resolves "cancelled" - never treated as an error (owner §16)', async () => {
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const share = vi.fn(async () => { throw abortError })
    const canShare = vi.fn(() => true)
    const result = await shareGeneratedImageBlob({ blob: fakeBlob(), filename: 'f.jpg', shareText: 't', share, canShare })
    expect(result).toEqual({ outcome: 'cancelled' })
  })

  it('navigator.canShare returns false: falls back to download, never attempts share()', async () => {
    const share = vi.fn(async () => {})
    const canShare = vi.fn(() => false)
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    const result = await shareGeneratedImageBlob({ blob: fakeBlob(), filename: 'f.jpg', shareText: 't', share, canShare })
    expect(result).toEqual({ outcome: 'downloaded' })
    expect(share).not.toHaveBeenCalled()
  })

  it('no navigator.share/canShare at all (unsupported browser): falls back to download', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    const result = await shareGeneratedImageBlob({ blob: fakeBlob(), filename: 'f.jpg', shareText: 't', share: undefined, canShare: undefined })
    expect(result).toEqual({ outcome: 'downloaded' })
  })

  it('share() fails for a reason OTHER than cancellation: still falls back to download - the image already exists, never a dead Share button (owner §14)', async () => {
    const share = vi.fn(async () => { throw new Error('NotAllowedError') })
    const canShare = vi.fn(() => true)
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    const result = await shareGeneratedImageBlob({ blob: fakeBlob(), filename: 'f.jpg', shareText: 't', share, canShare })
    expect(result).toEqual({ outcome: 'downloaded' })
  })

  it('even the download fallback fails (createObjectURL throws): resolves "download-failed", never throws', async () => {
    global.URL.createObjectURL = vi.fn(() => { throw new Error('boom') })
    const result = await shareGeneratedImageBlob({ blob: fakeBlob(), filename: 'f.jpg', shareText: 't', share: undefined, canShare: undefined })
    expect(result).toEqual({ outcome: 'download-failed' })
  })
})

describe('sharePhotoResultCardImage - top-level orchestration (owner §15)', () => {
  it('generation succeeds: hands the blob straight to the share step', async () => {
    const generateImage = vi.fn(async () => ({ blob: fakeBlob() }))
    const share = vi.fn(async () => {})
    const canShare = vi.fn(() => true)
    const result = await sharePhotoResultCardImage({
      cardProps: { photoUrl: 'https://x' }, filename: 'f.jpg', shareText: 't',
      generateImage, share, canShare,
    })
    expect(result).toEqual({ outcome: 'shared' })
    expect(generateImage).toHaveBeenCalledWith({ photoUrl: 'https://x' })
  })

  it('generation fails: invokes the caller\'s EXISTING text-share fallback, never reimplements it, resolves "render-failed"', async () => {
    const generateImage = vi.fn(async () => ({ blob: null, error: new Error('render failed') }))
    const onTextFallback = vi.fn(async () => {})
    const result = await sharePhotoResultCardImage({
      cardProps: {}, filename: 'f.jpg', shareText: 't', generateImage, onTextFallback,
    })
    expect(result.outcome).toBe('render-failed')
    expect(onTextFallback).toHaveBeenCalledTimes(1)
  })

  it('generation fails and no text fallback is supplied: never throws', async () => {
    const generateImage = vi.fn(async () => ({ blob: null, error: new Error('render failed') }))
    await expect(sharePhotoResultCardImage({ cardProps: {}, filename: 'f.jpg', shareText: 't', generateImage })).resolves.toMatchObject({ outcome: 'render-failed' })
  })

  it('a throwing text fallback is swallowed, never propagates', async () => {
    const generateImage = vi.fn(async () => ({ blob: null }))
    const onTextFallback = vi.fn(async () => { throw new Error('clipboard denied') })
    await expect(sharePhotoResultCardImage({ cardProps: {}, filename: 'f.jpg', shareText: 't', generateImage, onTextFallback })).resolves.toMatchObject({ outcome: 'render-failed' })
  })
})
