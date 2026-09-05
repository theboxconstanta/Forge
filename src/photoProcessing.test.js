import { describe, it, expect } from 'vitest'
import {
  isHeicFile, validatePhotoFile, buildWodPhotoStoragePath,
  ACCEPTED_SOURCE_MIME_TYPES, MAX_SOURCE_BYTES,
} from './photoProcessing.js'

const fakeFile = ({ type = 'image/jpeg', size = 1024, name = 'photo.jpg' } = {}) => ({ type, size, name })

describe('isHeicFile', () => {
  it('detects HEIC/HEIF by MIME type', () => {
    expect(isHeicFile(fakeFile({ type: 'image/heic' }))).toBe(true)
    expect(isHeicFile(fakeFile({ type: 'image/heif' }))).toBe(true)
    expect(isHeicFile(fakeFile({ type: 'IMAGE/HEIC' }))).toBe(true) // case-insensitive
  })
  it('detects HEIC/HEIF by file extension when MIME type is empty (Android picker gap)', () => {
    expect(isHeicFile(fakeFile({ type: '', name: 'IMG_1234.HEIC' }))).toBe(true)
    expect(isHeicFile(fakeFile({ type: '', name: 'photo.heif' }))).toBe(true)
  })
  it('a normal JPEG/PNG/WebP is never flagged as HEIC', () => {
    expect(isHeicFile(fakeFile({ type: 'image/jpeg', name: 'a.jpg' }))).toBe(false)
    expect(isHeicFile(fakeFile({ type: 'image/png', name: 'a.png' }))).toBe(false)
    expect(isHeicFile(fakeFile({ type: 'image/webp', name: 'a.webp' }))).toBe(false)
  })
})

describe('validatePhotoFile', () => {
  it('accepts JPEG, PNG, WebP within the size ceiling', () => {
    for (const type of ACCEPTED_SOURCE_MIME_TYPES) {
      expect(validatePhotoFile(fakeFile({ type, size: 1024 }))).toEqual({ valid: true })
    }
  })
  it('rejects HEIC/HEIF explicitly, distinct from a generic wrong-type rejection', () => {
    expect(validatePhotoFile(fakeFile({ type: 'image/heic' }))).toEqual({ valid: false, reason: 'heic' })
  })
  it('rejects an unrelated file type (e.g. video slipping past an accept= hint)', () => {
    expect(validatePhotoFile(fakeFile({ type: 'video/mp4' }))).toEqual({ valid: false, reason: 'wrong-type' })
  })
  it('rejects an oversized source file BEFORE any processing would be attempted', () => {
    expect(validatePhotoFile(fakeFile({ size: MAX_SOURCE_BYTES + 1 }))).toEqual({ valid: false, reason: 'too-large' })
    expect(validatePhotoFile(fakeFile({ size: MAX_SOURCE_BYTES }))).toEqual({ valid: true }) // exactly at the ceiling is fine
  })
  it('rejects a missing file safely (no crash on null/undefined)', () => {
    expect(validatePhotoFile(null)).toEqual({ valid: false, reason: 'empty' })
    expect(validatePhotoFile(undefined)).toEqual({ valid: false, reason: 'empty' })
  })
})

describe('buildWodPhotoStoragePath', () => {
  const ids = { gymId: 'gym-1', memberId: 'member-1', wodLogId: 'log-1', uuid: 'uuid-1' }
  it('builds the exact tenant/owner/result-scoped path', () => {
    expect(buildWodPhotoStoragePath(ids)).toBe('gym-1/member-1/log-1/uuid-1.jpg')
  })
  it('always ends in .jpg regardless of source format - the pipeline always re-encodes to JPEG', () => {
    expect(buildWodPhotoStoragePath(ids)).toMatch(/\.jpg$/)
  })
  it('never embeds the original filename', () => {
    const path = buildWodPhotoStoragePath({ ...ids, uuid: 'uuid-1' })
    expect(path).not.toMatch(/IMG_|\.heic|\.png|\.webp/i)
  })
  it('refuses to build a path missing any required id segment (never a partial/guessable path)', () => {
    expect(buildWodPhotoStoragePath({ ...ids, gymId: undefined })).toBeNull()
    expect(buildWodPhotoStoragePath({ ...ids, memberId: undefined })).toBeNull()
    expect(buildWodPhotoStoragePath({ ...ids, wodLogId: undefined })).toBeNull()
    expect(buildWodPhotoStoragePath({ ...ids, uuid: undefined })).toBeNull()
  })
})
