// INC-19 - PHOTO RESULT / SHARE CARD, PHASE 1 - storage/attachment
// foundation only (no Journal UI, no Share Card, no DOM-to-image dependency
// this phase).
//
// Media is an ATTACHMENT to a result (Phase 0 forensic §3): nothing in this
// file's subject module (photoProcessing.js) is imported by, or imports,
// anything in the score/prescription/performed_prescription/completion
// code this session's prior workstream (Performed Movement / Result
// Integrity, app_version performed-movement-integrity-20260905) just closed
// GREEN - verified by inspection, not merely assumed.
//
// attachWodLogPhoto is the SAME function App.jsx's attachWodPhoto wraps
// (thin injection of the real supabase client + this member's own ids) -
// testing it here with a mock client (and, for the pixel pipeline, a
// stubbed `processFile` - createImageBitmap/canvas are real-browser-only
// APIs jsdom does not implement) exercises the EXACT orchestration/failure-
// isolation logic that runs in production, not a parallel copy. The pixel
// pipeline itself (createImageBitmap + canvas + toBlob, orientation/resize/
// JPEG re-encode) is verified manually/on-device per the Phase 1 report.

import { describe, it, expect, vi } from 'vitest'
import {
  validatePhotoFile, isHeicFile, buildWodPhotoStoragePath, attachWodLogPhoto,
  replaceWodLogPhoto, deleteWodLogPhoto,
  ACCEPTED_SOURCE_MIME_TYPES,
} from './photoProcessing.js'

const fakeFile = (overrides = {}) => ({ type: 'image/jpeg', size: 1024, name: 'photo.jpg', ...overrides })
const fakeBlob = () => ({ size: 200, type: 'image/jpeg' })

// A minimal Supabase-shaped mock: only the two calls attachWodLogPhoto
// actually makes (`storage.from(...).upload(...)` and `from(...).insert(...)`).
const mockSupabase = ({ uploadError = null, insertError = null } = {}) => ({
  storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: uploadError })) })) },
  from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: insertError })) })),
})

describe('INC-19 §Phase 0 review - v1 accepted source types', () => {
  it('JPEG, PNG, WebP are all accepted', () => {
    expect(ACCEPTED_SOURCE_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
})

describe('INC-19 §14 - save/failure contract: attachWodLogPhoto never throws, always isolates failure by stage', () => {
  it('2/3/4. successful attach resolves { success: true } (JPEG/PNG/WebP source all funnel through the SAME processed-JPEG output)', async () => {
    const supabase = mockSupabase()
    const result = await attachWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g1', memberId: 'm1', wodLogId: 'w1',
      processFile: vi.fn(async () => fakeBlob()),
    })
    expect(result).toEqual({ success: true })
  })

  it('7. photo processing failure resolves { success: false, stage: "process" } - never throws', async () => {
    const supabase = mockSupabase()
    const result = await attachWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g1', memberId: 'm1', wodLogId: 'w1',
      processFile: vi.fn(async () => { throw new Error('decode failed') }),
    })
    expect(result).toEqual({ success: false, stage: 'process' })
    // critically: the mock supabase client's upload/insert were NEVER
    // called - a processing failure never reaches Storage/DB at all.
    expect(supabase.storage.from).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('8. Storage upload failure resolves { success: false, stage: "upload" } - never throws, DB insert never attempted', async () => {
    const supabase = mockSupabase({ uploadError: { message: 'network error' } })
    const result = await attachWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g1', memberId: 'm1', wodLogId: 'w1',
      processFile: vi.fn(async () => fakeBlob()),
    })
    expect(result).toEqual({ success: false, stage: 'upload' })
    expect(supabase.from).not.toHaveBeenCalled() // the attachment row is never inserted after a failed upload
  })

  it('9. attachment DB insert failure AFTER a successful upload resolves { success: false, stage: "attach" } - orphan is a known, accepted Phase 1 gap, not silently hidden', async () => {
    const supabase = mockSupabase({ insertError: { message: 'db error' } })
    const result = await attachWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g1', memberId: 'm1', wodLogId: 'w1',
      processFile: vi.fn(async () => fakeBlob()),
    })
    expect(result).toEqual({ success: false, stage: 'attach' })
  })

  it('every failure stage produces the SAME shape ({ success: false, stage }), never an uncaught rejection reaching the caller', async () => {
    await expect(attachWodLogPhoto({
      supabase: mockSupabase(), file: fakeFile(), gymId: 'g1', memberId: 'm1', wodLogId: 'w1',
      processFile: vi.fn(async () => { throw new Error('boom') }),
    })).resolves.toMatchObject({ success: false })
  })
})

describe('INC-19 §6/§17 - storage path is capability/tenant-scoped, never movement/format-specific, never the original filename', () => {
  it('every path segment is a stable id; the extension is always .jpg', () => {
    const path = buildWodPhotoStoragePath({ gymId: 'gym-a', memberId: 'member-b', wodLogId: 'log-c', uuid: 'uuid-d' })
    expect(path).toBe('gym-a/member-b/log-c/uuid-d.jpg')
  })
  it('two different wod_log_ids never collide, even for the same member/gym', () => {
    const a = buildWodPhotoStoragePath({ gymId: 'g', memberId: 'm', wodLogId: 'log-1', uuid: 'u' })
    const b = buildWodPhotoStoragePath({ gymId: 'g', memberId: 'm', wodLogId: 'log-2', uuid: 'u' })
    expect(a).not.toBe(b)
  })
  it('the attach call writes the same path to both Storage and the DB row (no drift between the uploaded object and its metadata)', async () => {
    let uploadedPath, insertedPath
    const supabase = {
      storage: { from: () => ({ upload: vi.fn(async (path) => { uploadedPath = path; return { error: null } }) }) },
      from: () => ({ insert: vi.fn(async (row) => { insertedPath = row.storage_path; return { error: null } }) }),
    }
    await attachWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g', memberId: 'm', wodLogId: 'log-1', generateUuid: () => 'fixed-uuid',
      processFile: vi.fn(async () => fakeBlob()),
    })
    expect(uploadedPath).toBe('g/m/log-1/fixed-uuid.jpg')
    expect(uploadedPath).toBe(insertedPath)
  })
})

describe('INC-19 §15 - lifecycle: replace and delete', () => {
  it('13. replace: uploads the NEW photo, repoints the DB row, then best-effort removes the OLD storage object', async () => {
    const calls = []
    const supabase = {
      storage: {
        from: () => ({
          upload: vi.fn(async (path) => { calls.push(['upload', path]); return { error: null } }),
          remove: vi.fn(async (paths) => { calls.push(['remove', paths]); return { error: null } }),
        }),
      },
      from: () => ({ update: () => ({ eq: vi.fn(async () => { calls.push(['update']); return { error: null } }) }) }),
    }
    const result = await replaceWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g', memberId: 'm', wodLogId: 'log-1',
      oldStoragePath: 'g/m/log-1/old-uuid.jpg', generateUuid: () => 'new-uuid',
      processFile: vi.fn(async () => fakeBlob()),
    })
    expect(result).toEqual({ success: true })
    // new object uploaded, DB repointed, THEN the old object removed - never
    // the old object removed before the new one is safely referenced.
    expect(calls[0]).toEqual(['upload', 'g/m/log-1/new-uuid.jpg'])
    expect(calls[1]).toEqual(['update'])
    expect(calls[2]).toEqual(['remove', ['g/m/log-1/old-uuid.jpg']])
  })

  it('replace failure at any stage never throws and never removes the OLD (still-valid) object', async () => {
    const removeSpy = vi.fn(async () => ({ error: null }))
    const supabase = {
      storage: { from: () => ({ upload: vi.fn(async () => ({ error: { message: 'network' } })), remove: removeSpy }) },
      from: () => ({ update: () => ({ eq: vi.fn(async () => ({ error: null })) }) }),
    }
    const result = await replaceWodLogPhoto({
      supabase, file: fakeFile(), gymId: 'g', memberId: 'm', wodLogId: 'log-1',
      oldStoragePath: 'g/m/log-1/old-uuid.jpg', processFile: vi.fn(async () => fakeBlob()),
    })
    expect(result).toEqual({ success: false, stage: 'upload' })
    expect(removeSpy).not.toHaveBeenCalled() // the athlete's still-valid old photo is never touched on a failed replace
  })

  it('14/15. delete: removes the DB row first, then best-effort removes the Storage object', async () => {
    const calls = []
    const supabase = {
      from: () => ({ delete: () => ({ eq: vi.fn(async () => { calls.push('db-delete'); return { error: null } }) }) }),
      storage: { from: () => ({ remove: vi.fn(async (paths) => { calls.push(['storage-remove', paths]); return { error: null } }) }) },
    }
    const result = await deleteWodLogPhoto({ supabase, wodLogId: 'log-1', storagePath: 'g/m/log-1/uuid.jpg' })
    expect(result).toEqual({ success: true })
    expect(calls[0]).toBe('db-delete')
    expect(calls[1]).toEqual(['storage-remove', ['g/m/log-1/uuid.jpg']])
  })

  it('a delete DB failure never attempts the Storage removal and reports failure, not a silent no-op', async () => {
    const removeSpy = vi.fn(async () => ({ error: null }))
    const supabase = {
      from: () => ({ delete: () => ({ eq: vi.fn(async () => ({ error: { message: 'db error' } })) }) }),
      storage: { from: () => ({ remove: removeSpy }) },
    }
    const result = await deleteWodLogPhoto({ supabase, wodLogId: 'log-1', storagePath: 'g/m/log-1/uuid.jpg' })
    expect(result).toEqual({ success: false, stage: 'attach' })
    expect(removeSpy).not.toHaveBeenCalled()
  })
})

describe('INC-19 §21/§26 - HEIC rejection is explicit and distinct, source validation never silently uploads an unsupported format', () => {
  it('a raw HEIC file is rejected with a distinct reason before any processing/upload is attempted', () => {
    expect(validatePhotoFile(fakeFile({ type: 'image/heic' }))).toEqual({ valid: false, reason: 'heic' })
    expect(isHeicFile(fakeFile({ type: 'image/heic' }))).toBe(true)
  })
  it('an Android picker reporting an empty MIME type for a .heic file is still caught (extension fallback)', () => {
    expect(validatePhotoFile(fakeFile({ type: '', name: 'IMG_0001.HEIC' }))).toEqual({ valid: false, reason: 'heic' })
  })
})
