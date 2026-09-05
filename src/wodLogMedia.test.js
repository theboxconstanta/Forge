import { describe, it, expect, vi } from 'vitest'
import { extractWodLogMedia, getWodLogPhotoSignedUrl, resolveJustAttachedPhotoUrl, WOD_PHOTO_SIGNED_URL_TTL_SECONDS } from './wodLogMedia.js'

describe('extractWodLogMedia - normalizes the embedded relation Journal fetches with its log list', () => {
  it('a one-object embed (some PostgREST versions, one-to-one FK) resolves storagePath', () => {
    expect(extractWodLogMedia({ storage_path: 'g/m/w/uuid.jpg' })).toEqual({ storagePath: 'g/m/w/uuid.jpg' })
  })
  it('a one-item array embed (other PostgREST versions) resolves the same way', () => {
    expect(extractWodLogMedia([{ storage_path: 'g/m/w/uuid.jpg' }])).toEqual({ storagePath: 'g/m/w/uuid.jpg' })
  })
  it('no attachment (empty array, null, or undefined) resolves null - never a signed-URL fetch is even attempted downstream', () => {
    expect(extractWodLogMedia([])).toBeNull()
    expect(extractWodLogMedia(null)).toBeNull()
    expect(extractWodLogMedia(undefined)).toBeNull()
  })
})

describe('getWodLogPhotoSignedUrl - never throws, never persists, always a fresh request', () => {
  it('resolves { url } from a successful createSignedUrl call, using the given TTL', async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }))
    const supabase = { storage: { from: vi.fn(() => ({ createSignedUrl })) } }
    const result = await getWodLogPhotoSignedUrl({ supabase, storagePath: 'g/m/w/uuid.jpg' })
    expect(result).toEqual({ url: 'https://signed.example/x' })
    expect(createSignedUrl).toHaveBeenCalledWith('g/m/w/uuid.jpg', WOD_PHOTO_SIGNED_URL_TTL_SECONDS)
  })
  it('a Storage error (e.g. cross-tenant RLS denial, missing object) resolves { url: null } - never throws', async () => {
    const supabase = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'not found' } }) }) } }
    await expect(getWodLogPhotoSignedUrl({ supabase, storagePath: 'g/m/w/uuid.jpg' })).resolves.toEqual({ url: null })
  })
  it('a thrown network error resolves { url: null } - never an uncaught rejection reaching the caller', async () => {
    const supabase = { storage: { from: () => ({ createSignedUrl: async () => { throw new Error('network') } }) } }
    await expect(getWodLogPhotoSignedUrl({ supabase, storagePath: 'g/m/w/uuid.jpg' })).resolves.toEqual({ url: null })
  })
  it('no storagePath (no attachment) resolves { url: null } without ever calling Storage', async () => {
    const createSignedUrl = vi.fn()
    const supabase = { storage: { from: () => ({ createSignedUrl }) } }
    await expect(getWodLogPhotoSignedUrl({ supabase, storagePath: null })).resolves.toEqual({ url: null })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})

describe('resolveJustAttachedPhotoUrl - reads back the row Phase 1 attachWodLogPhoto just wrote, then signs it', () => {
  it('resolves a signed URL for the freshly attached photo', async () => {
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_path: 'g/m/w/uuid.jpg' }, error: null }) }) }) }),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/y' }, error: null }) }) },
    }
    await expect(resolveJustAttachedPhotoUrl({ supabase, wodLogId: 'w1' })).resolves.toEqual({ url: 'https://signed.example/y' })
  })
  it('a DB read failure (e.g. attach actually never landed) resolves { url: null } - never throws', async () => {
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db error' } }) }) }) }) }
    await expect(resolveJustAttachedPhotoUrl({ supabase, wodLogId: 'w1' })).resolves.toEqual({ url: null })
  })
  it('a thrown exception resolves { url: null } - never an uncaught rejection reaching the caller', async () => {
    const supabase = { from: () => { throw new Error('boom') } }
    await expect(resolveJustAttachedPhotoUrl({ supabase, wodLogId: 'w1' })).resolves.toEqual({ url: null })
  })
})
