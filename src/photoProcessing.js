// PHOTO RESULT / SHARE CARD — Phase 1: client-side photo validation,
// path-building, and processing pipeline.
//
// Media is an ATTACHMENT to a result (Phase 0 forensic §3) - nothing in this
// module ever touches score/prescription/performed_prescription/completion
// semantics, and nothing here is imported by any of those code paths.
//
// Pipeline (owner-approved direction): decode -> normalize orientation ->
// resize -> canvas re-render -> JPEG output. Metadata (EXIF, including GPS)
// is removed as a NATURAL CONSEQUENCE of the canvas round-trip - a
// canvas-produced JPEG carries no EXIF block at all - not a separate
// stripping step. HEIC/HEIF is rejected outright, never uploaded raw, never
// converted (no conversion infrastructure added this phase).

// Accepted SOURCE mime types (owner-approved v1 list). HEIC/HEIF is
// deliberately absent - see rejectsHeic below. Anything else (video,
// documents, svg, etc.) is rejected the same way uploadAvatar already
// rejects a non-image file, before any network call.
export const ACCEPTED_SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Reject before even attempting client-side decode/processing - protects
// low-end devices from freezing on an enormous decode, and gives the athlete
// an immediate, clear reason instead of a silent hang or a generic storage
// error surfacing minutes later.
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024 // 20 MB

// Output constraints (Phase 0 forensic §8) - ample for a 1:1 share card and
// for an in-app detail view, well below typical modern phone camera output.
export const MAX_OUTPUT_DIMENSION = 1600
export const OUTPUT_JPEG_QUALITY = 0.8
export const OUTPUT_MIME_TYPE = 'image/jpeg'

// Some Android/Samsung picker paths report an empty file.type for a HEIC
// file rather than 'image/heic' (the same class of gap uploadAvatar's own
// comment documents for a stray video/mp4 slipping past accept="image/*") -
// so HEIC/HEIF is detected by extension too, not MIME type alone.
const HEIC_EXTENSION_RE = /\.(heic|heif)$/i

/** Is this file a HEIC/HEIF source? Checked BEFORE the generic accepted-type
 * check so the rejection message can be specific ("HEIC not supported")
 * rather than a generic "wrong file type". Pure. */
export function isHeicFile(file) {
  const type = (file?.type || '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  return HEIC_EXTENSION_RE.test(file?.name || '')
}

/** Validate a picked/captured file BEFORE any decode/processing/upload is
 * attempted. Returns { valid: true } or { valid: false, reason }, where
 * `reason` is one of 'heic' | 'wrong-type' | 'too-large' | 'empty' - the
 * caller maps each to a user-facing message (mirrors uploadAvatar's existing
 * "check first, clear message" pattern, never a generic storage error
 * surfacing after the fact). Pure. */
export function validatePhotoFile(file) {
  if (!file) return { valid: false, reason: 'empty' }
  if (isHeicFile(file)) return { valid: false, reason: 'heic' }
  if (!ACCEPTED_SOURCE_MIME_TYPES.includes((file.type || '').toLowerCase())) return { valid: false, reason: 'wrong-type' }
  if (file.size > MAX_SOURCE_BYTES) return { valid: false, reason: 'too-large' }
  return { valid: true }
}

/** Build the tenant/owner/result-scoped storage path this photo's RLS
 * policies key on: <gym_id>/<member_id>/<wod_log_id>/<uuid>.jpg. Every
 * segment is a stable id, never user input, never the original filename
 * (Phase 0 forensic §6/§17 - no PII-heavy filenames, no original-filename
 * dependency). The extension is always .jpg - the processing pipeline always
 * re-encodes to JPEG regardless of source format. `uuid` should be a fresh
 * crypto.randomUUID() per upload (the caller's responsibility - kept out of
 * this pure function so it stays deterministically testable). Pure. */
export function buildWodPhotoStoragePath({ gymId, memberId, wodLogId, uuid }) {
  if (!gymId || !memberId || !wodLogId || !uuid) return null
  return `${gymId}/${memberId}/${wodLogId}/${uuid}.jpg`
}

/** Best-effort attach: process -> upload -> insert the attachment row. NEVER
 * throws - always resolves { success: true } or { success: false, stage },
 * where `stage` is 'process' | 'upload' | 'attach' (which step failed, for
 * diagnostics only - the owner save contract treats every photo failure
 * identically from the athlete's point of view: the WOD result is already
 * saved and safe, one single "photo didn't save" message, never a
 * differentiated UX per failure stage in v1).
 *
 * Takes an injected `supabase` client, an injectable `generateUuid`
 * (defaulting to crypto.randomUUID), and an injectable `processFile`
 * (defaulting to the real processPhotoFile - a browser-native canvas
 * pipeline jsdom cannot run, so tests inject a stub here to exercise the
 * orchestration/failure-isolation logic itself) so every stage is directly
 * unit-testable - no behavior difference for the real caller, which never
 * passes these overrides. Never touches wod_logs, score,
 * prescription_snapshot, or performed_prescription - the caller only ever
 * invokes this AFTER the WOD result has already saved successfully, with
 * that row's real id. */
export async function attachWodLogPhoto({ supabase, file, gymId, memberId, wodLogId, generateUuid = () => crypto.randomUUID(), processFile = processPhotoFile }) {
  let processed
  try {
    processed = await processFile(file)
  } catch (e) {
    console.error(e)
    return { success: false, stage: 'process' }
  }
  const path = buildWodPhotoStoragePath({ gymId, memberId, wodLogId, uuid: generateUuid() })
  if (!path) return { success: false, stage: 'process' }
  const { error: upErr } = await supabase.storage.from('wod-photos').upload(path, processed, { upsert: true, contentType: 'image/jpeg' })
  if (upErr) { console.error(upErr); return { success: false, stage: 'upload' } }
  const { error: dbErr } = await supabase.from('wod_log_media').insert({
    gym_id: gymId, member_id: memberId, wod_log_id: wodLogId, storage_path: path, mime_type: 'image/jpeg',
  })
  if (dbErr) { console.error(dbErr); return { success: false, stage: 'attach' } }
  return { success: true }
}

/** Replace an existing photo attachment: upload the new processed photo to a
 * FRESH path (paths are never reused - Phase 0 forensic §17), update the
 * wod_log_media row to point at it, then best-effort remove the OLD Storage
 * object. Ordering matters: the DB row is repointed to the NEW object before
 * the OLD one is removed, so a reader can never observe a row pointing at an
 * already-deleted object. A failure removing the old object is logged, never
 * surfaced as a failure to the athlete (the replace itself already
 * succeeded) and never retried automatically in Phase 1 - a harmless orphan,
 * same accepted-gap class as Phase 1's other known Storage-cleanup limits.
 * Same { success, stage } contract as attachWodLogPhoto - never throws. */
export async function replaceWodLogPhoto({ supabase, file, gymId, memberId, wodLogId, oldStoragePath, generateUuid = () => crypto.randomUUID(), processFile = processPhotoFile }) {
  let processed
  try {
    processed = await processFile(file)
  } catch (e) {
    console.error(e)
    return { success: false, stage: 'process' }
  }
  const path = buildWodPhotoStoragePath({ gymId, memberId, wodLogId, uuid: generateUuid() })
  if (!path) return { success: false, stage: 'process' }
  const { error: upErr } = await supabase.storage.from('wod-photos').upload(path, processed, { contentType: 'image/jpeg' })
  if (upErr) { console.error(upErr); return { success: false, stage: 'upload' } }
  const { error: dbErr } = await supabase.from('wod_log_media').update({ storage_path: path, mime_type: 'image/jpeg' }).eq('wod_log_id', wodLogId)
  if (dbErr) { console.error(dbErr); return { success: false, stage: 'attach' } }
  if (oldStoragePath && oldStoragePath !== path) {
    const { error: rmErr } = await supabase.storage.from('wod-photos').remove([oldStoragePath])
    if (rmErr) console.error(rmErr)
  }
  return { success: true }
}

/** Delete an existing photo attachment entirely: remove the DB row FIRST,
 * then best-effort remove the Storage object - same ordering rationale as
 * WOD-log deletion below (never leave a "result exists, still references a
 * photo" state hanging on an unreliable second step; a Storage-removal
 * failure after a successful DB delete is logged, never surfaced to the
 * athlete as a failure, and never retried automatically in Phase 1).
 * Resolves { success, stage: 'attach' | undefined } - never throws. */
export async function deleteWodLogPhoto({ supabase, wodLogId, storagePath }) {
  const { error: dbErr } = await supabase.from('wod_log_media').delete().eq('wod_log_id', wodLogId)
  if (dbErr) { console.error(dbErr); return { success: false, stage: 'attach' } }
  if (storagePath) {
    const { error: rmErr } = await supabase.storage.from('wod-photos').remove([storagePath])
    if (rmErr) console.error(rmErr)
  }
  return { success: true }
}

/** Decode a validated image file, normalize its EXIF orientation, resize so
 * its longest edge is at most maxDimension, and re-encode as JPEG via a
 * canvas round-trip (which also strips ALL metadata, GPS included, as a
 * structural side effect - a canvas-produced JPEG carries no EXIF block).
 * Browser-native only (createImageBitmap + canvas) - no new dependency.
 * Returns a Blob. Throws if the browser cannot decode the file (the caller
 * is expected to catch this and show the same "photo processing failed, your
 * result is still saved" messaging Phase 0 §14/owner's save contract
 * requires - a decode failure must never be treated as a save failure). */
export async function processPhotoFile(file, { maxDimension = MAX_OUTPUT_DIMENSION, quality = OUTPUT_JPEG_QUALITY } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), OUTPUT_MIME_TYPE, quality)
    })
    return blob
  } finally {
    bitmap.close?.()
  }
}
