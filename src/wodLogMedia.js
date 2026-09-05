// PHOTO RESULT / SHARE CARD — Phase 2: signed-URL lookup for an already-
// attached photo. Never persists a signed URL (owner §5/§16 - a signed URL
// is requested fresh every time a result is opened, never stored in the DB,
// never kept once the modal/expanded card that requested it is gone). Never
// throws - a lookup failure (missing row, missing object, RLS denial,
// network error) resolves { url: null } so the caller can fall back to its
// own plain, no-photo result rendering (owner's safe-fallback contract) -
// this module never decides UI, only resolves a URL or the absence of one.
//
// Tenant/ownership isolation is NOT re-implemented here: `createSignedUrl`
// itself is gated by the Phase 1 Storage RLS policies (same-gym SELECT) -
// a cross-tenant caller gets { url: null } from the underlying Supabase
// call, exactly like any other denied read, never a special code path.

// 5 minutes - long enough for one opened modal/expanded-card session, short
// enough that nothing worth guarding is ever persisted or reusable later
// (owner §16 - no multi-day/permanent URLs).
export const WOD_PHOTO_SIGNED_URL_TTL_SECONDS = 300

/** Normalizes the embedded `wod_log_media` relation a `wod_logs` select can
 * carry (an array on some PostgREST versions, a single object on others,
 * since the FK is UNIQUE/one-to-one) into { storagePath } or null - so
 * callers (Journal) never special-case the shape themselves. Pure. */
export function extractWodLogMedia(wodLogMediaField) {
  const row = Array.isArray(wodLogMediaField) ? wodLogMediaField[0] : wodLogMediaField
  return row?.storage_path ? { storagePath: row.storage_path } : null
}

/** Request a fresh signed URL for an already-known storage path (the
 * Journal path - the path arrives batched with the log list itself via the
 * lightweight `wod_log_media(storage_path)` embed, no separate metadata
 * query needed - owner §17). Resolves { url } or { url: null } - never
 * throws. */
export async function getWodLogPhotoSignedUrl({ supabase, storagePath, expiresInSeconds = WOD_PHOTO_SIGNED_URL_TTL_SECONDS }) {
  if (!storagePath) return { url: null }
  try {
    const { data, error } = await supabase.storage.from('wod-photos').createSignedUrl(storagePath, expiresInSeconds)
    if (error || !data?.signedUrl) return { url: null }
    return { url: data.signedUrl }
  } catch {
    return { url: null }
  }
}

/** Resolve a signed URL for a photo that was JUST attached this session
 * (the post-save share popup path). Phase 1's `attachWodLogPhoto` resolves
 * only { success }, not the path it chose internally, so the freshly
 * written `wod_log_media` row is read back once here rather than
 * duplicating path-generation logic. Resolves { url } or { url: null } -
 * never throws. */
export async function resolveJustAttachedPhotoUrl({ supabase, wodLogId, expiresInSeconds = WOD_PHOTO_SIGNED_URL_TTL_SECONDS }) {
  try {
    const { data, error } = await supabase.from('wod_log_media').select('storage_path').eq('wod_log_id', wodLogId).maybeSingle()
    if (error || !data?.storage_path) return { url: null }
    return getWodLogPhotoSignedUrl({ supabase, storagePath: data.storage_path, expiresInSeconds })
  } catch {
    return { url: null }
  }
}
