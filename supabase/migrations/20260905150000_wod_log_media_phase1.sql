-- PHOTO RESULT / SHARE CARD — PHASE 1: photo storage + attachment foundation.
--
-- Media is an ATTACHMENT to a result, never part of it. This migration does
-- NOT touch wod_logs (score/prescription_snapshot/performed_prescription/
-- completion/variant semantics, or any trigger on that table) at all - it
-- only adds a new, independent table + a new, independent private Storage
-- bucket. The just-closed Performed Movement / Result Integrity workstream
-- (app_version performed-movement-integrity-20260905) is untouched.
--
-- Ownership mirrors wod_logs' own already-live RLS shape exactly:
--   - gym_id   : tenant boundary, same my_gym_id() helper wod_logs itself uses
--   - member_id: uploader, same auth.users(id) ON DELETE CASCADE target
--                wod_logs.member_id already uses
--   - wod_log_id: the specific result this photo belongs to (ON DELETE
--                CASCADE — the DB row disappears automatically when its
--                wod_log is deleted). NOTE (explicit, not silently omitted):
--                this cascade removes the wod_log_media ROW only. It does
--                NOT remove the underlying Storage object — Postgres FK
--                cascades cannot reach into Supabase Storage. Phase 1's
--                application-level cleanup covers explicit replace/delete of
--                the photo itself (both delete the Storage object directly);
--                WOD-log deletion leaving an orphaned Storage object is a
--                known, accepted Phase 1 gap (see the Phase 1 report).
--
-- Read scope (owner decision 1): every authenticated member of the SAME gym
-- may view a photo - mirrors wod_logs_select_all's own gym-wide read policy,
-- never public, never cross-tenant.
-- Write scope (owner decision 2): a member owns (insert/replace/delete) only
-- their own photo. A coach/admin for the SAME gym may DELETE/moderate any
-- same-gym photo but has no UPDATE grant at all (cannot replace another
-- member's photo) - moderation is remove-only, using the existing canonical
-- is_admin(gid)/is_coach_or_admin(gid) role functions, never a new role
-- system.
-- One-photo-per-log (owner decision 6): enforced at the DATABASE level via
-- UNIQUE(wod_log_id), not merely in application code.

CREATE TABLE IF NOT EXISTS wod_log_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wod_log_id uuid NOT NULL UNIQUE REFERENCES wod_logs(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wod_log_media_gym_id_idx ON wod_log_media(gym_id);
CREATE INDEX IF NOT EXISTS wod_log_media_member_id_idx ON wod_log_media(member_id);
-- wod_log_id already carries a unique index via the UNIQUE constraint above.

ALTER TABLE wod_log_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wod_log_media_select_same_gym" ON wod_log_media;
DROP POLICY IF EXISTS "wod_log_media_insert_own" ON wod_log_media;
DROP POLICY IF EXISTS "wod_log_media_update_own" ON wod_log_media;
DROP POLICY IF EXISTS "wod_log_media_delete_own_or_staff" ON wod_log_media;

CREATE POLICY "wod_log_media_select_same_gym" ON wod_log_media FOR SELECT
  USING (gym_id = my_gym_id());

CREATE POLICY "wod_log_media_insert_own" ON wod_log_media FOR INSERT
  WITH CHECK (member_id = auth.uid() AND gym_id = my_gym_id());

CREATE POLICY "wod_log_media_update_own" ON wod_log_media FOR UPDATE
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

CREATE POLICY "wod_log_media_delete_own_or_staff" ON wod_log_media FOR DELETE
  USING (member_id = auth.uid() OR is_coach_or_admin(gym_id));

-- ==========================================================================
-- STORAGE — private bucket, path <gym_id>/<member_id>/<wod_log_id>/<uuid>.jpg
-- ==========================================================================
-- Deliberately NOT the 'avatars' bucket's public pattern (Phase 0 forensic
-- §6/§9): a WOD photo may show gym interiors or other identifiable people,
-- a materially different privacy posture than an intentionally-public
-- profile picture. public=false; every read goes through a freshly-issued
-- signed URL, requested only when a specific result is explicitly opened
-- (never for a whole Journal/Leaderboard page at once).
--
-- allowed_mime_types is JPEG-only because the client-side pipeline (Phase 0
-- §8/§9) always decodes/normalizes-orientation/resizes/re-encodes to JPEG
-- before upload, regardless of source format (JPEG/PNG/WebP in; HEIC/HEIF
-- rejected client-side, never uploaded raw) - the bucket-level restriction
-- is a defense-in-depth boundary, not the primary validation (that happens
-- client-side, before any network call, mirroring uploadAvatar's existing
-- pattern of client checks + a matching server-side bucket constraint).
-- file_size_limit (5 MB) is a ceiling on the ALREADY-PROCESSED output
-- (target ~150-400 KB per Phase 0 §8), never a substitute for it.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wod-photos', 'wod-photos', false, 5242880, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg'];

DROP POLICY IF EXISTS "wod_photos_select_same_gym" ON storage.objects;
DROP POLICY IF EXISTS "wod_photos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "wod_photos_update_own" ON storage.objects;
DROP POLICY IF EXISTS "wod_photos_delete_own_or_staff" ON storage.objects;

-- Path shape: <gym_id>/<member_id>/<wod_log_id>/<uuid>.jpg
-- (storage.foldername(name))[1] = gym segment, [2] = member segment.
CREATE POLICY "wod_photos_select_same_gym" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'wod-photos' AND (storage.foldername(name))[1] = my_gym_id()::text);

CREATE POLICY "wod_photos_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wod-photos'
    AND (storage.foldername(name))[1] = my_gym_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text);

CREATE POLICY "wod_photos_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'wod-photos'
    AND (storage.foldername(name))[1] = my_gym_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text);

-- Delete: the uploading member OR a same-gym coach/admin (moderation) - the
-- gym check first constrains the object to the caller's OWN gym (my_gym_id()),
-- so is_coach_or_admin(my_gym_id()) at that point IS "is the caller staff of
-- THIS object's gym" - never a caller-supplied value trusted on its own.
CREATE POLICY "wod_photos_delete_own_or_staff" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wod-photos'
    AND (storage.foldername(name))[1] = my_gym_id()::text
    AND ((storage.foldername(name))[2] = auth.uid()::text OR is_coach_or_admin(my_gym_id())));
