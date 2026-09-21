-- LEADERBOARD SOCIAL INTERACTIONS V1 - reactions + comments on individual
-- wod_logs results (owner-approved forensic + architecture,
-- docs/architecture/LEADERBOARD_SOCIAL_INTERACTIONS_V1_20260921.md).
--
-- Purely additive: two new tables, one new composite UNIQUE constraint on the
-- already-PK'd wod_logs.id (no data change, no existing-row impact, no other
-- column/trigger/view touched). No change to wod_logs scoring surface
-- (prescription_snapshot/performed_prescription/completion/variant semantics).
--
-- CROSS-GYM TARGET INTEGRITY (mandatory owner requirement, §3 of the
-- architecture doc): the existing wod_log_media precedent does NOT actually
-- enforce that its wod_log_id belongs to its own gym_id (its FK only checks
-- the row exists, not its gym). That gap is deliberately NOT copied here.
-- Instead: wod_logs gets a (id, gym_id) UNIQUE constraint (free - id is
-- already the PK), and both new tables reference wod_logs(id, gym_id) via a
-- composite FK on (wod_log_id, gym_id). A forged "own gym_id + another gym's
-- wod_log_id" pair has no matching row in wod_logs, so Postgres rejects the
-- INSERT/UPDATE regardless of what the client sends - this applies to UPDATE
-- identically to INSERT, since Postgres enforces FK constraints on both.

ALTER TABLE wod_logs ADD CONSTRAINT wod_logs_id_gym_id_key UNIQUE (id, gym_id);

-- ==========================================================================
-- REACTIONS - one active emoji per member per result (owner decision §4).
-- UNIQUE(wod_log_id, member_id) deliberately excludes emoji: "one active
-- reaction per member" is a database guarantee, not app-code discipline.
-- Emoji swap = UPDATE; same-emoji re-tap = DELETE (client-side toggle logic,
-- src/leaderboardSocial.js). The CHECK pins the approved 5-emoji set
-- server-side (an improvement over feed_reactions' unvalidated free text).
-- ==========================================================================

CREATE TABLE IF NOT EXISTS wod_log_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wod_log_id uuid NOT NULL,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','🔥','💪','👏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wod_log_reactions_one_per_member UNIQUE (wod_log_id, member_id),
  CONSTRAINT wod_log_reactions_log_gym_fkey FOREIGN KEY (wod_log_id, gym_id)
    REFERENCES wod_logs(id, gym_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS wod_log_reactions_log_idx ON wod_log_reactions(wod_log_id);
CREATE INDEX IF NOT EXISTS wod_log_reactions_gym_idx ON wod_log_reactions(gym_id);

ALTER TABLE wod_log_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wod_log_reactions_select_same_gym" ON wod_log_reactions;
DROP POLICY IF EXISTS "wod_log_reactions_insert_own" ON wod_log_reactions;
DROP POLICY IF EXISTS "wod_log_reactions_update_own" ON wod_log_reactions;
DROP POLICY IF EXISTS "wod_log_reactions_delete_own" ON wod_log_reactions;

CREATE POLICY "wod_log_reactions_select_same_gym" ON wod_log_reactions FOR SELECT
  USING (gym_id = my_gym_id());

CREATE POLICY "wod_log_reactions_insert_own" ON wod_log_reactions FOR INSERT
  WITH CHECK (member_id = auth.uid() AND gym_id = my_gym_id());

-- Emoji swap only - member_id/gym_id/wod_log_id retargeting is independently
-- blocked by the composite FK (a changed wod_log_id must still satisfy
-- (wod_log_id, gym_id) existing in wod_logs) and by this WITH CHECK (a
-- changed gym_id must still equal the caller's own gym).
CREATE POLICY "wod_log_reactions_update_own" ON wod_log_reactions FOR UPDATE
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid() AND gym_id = my_gym_id());

-- Own-only, deliberately no staff clause: an emoji reaction isn't moderatable
-- content the way a wod_log_media photo is (owner decision §1/§4).
CREATE POLICY "wod_log_reactions_delete_own" ON wod_log_reactions FOR DELETE
  USING (member_id = auth.uid());

-- ==========================================================================
-- COMMENTS - plain text 1-500 chars. edited_at NULL = never edited (the
-- "edited" indicator), no backfill ambiguity. Author edit/delete; coach/admin
-- delete-only moderation (owner decision §1: never silent rewriting of a
-- member's words, even by staff).
-- ==========================================================================

CREATE TABLE IF NOT EXISTS wod_log_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wod_log_id uuid NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  CONSTRAINT wod_log_comments_log_gym_fkey FOREIGN KEY (wod_log_id, gym_id)
    REFERENCES wod_logs(id, gym_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS wod_log_comments_log_created_idx ON wod_log_comments(wod_log_id, created_at);
CREATE INDEX IF NOT EXISTS wod_log_comments_gym_idx ON wod_log_comments(gym_id);

ALTER TABLE wod_log_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wod_log_comments_select_same_gym" ON wod_log_comments;
DROP POLICY IF EXISTS "wod_log_comments_insert_own" ON wod_log_comments;
DROP POLICY IF EXISTS "wod_log_comments_update_own" ON wod_log_comments;
DROP POLICY IF EXISTS "wod_log_comments_delete_own_or_staff" ON wod_log_comments;

CREATE POLICY "wod_log_comments_select_same_gym" ON wod_log_comments FOR SELECT
  USING (gym_id = my_gym_id());

CREATE POLICY "wod_log_comments_insert_own" ON wod_log_comments FOR INSERT
  WITH CHECK (member_id = auth.uid() AND gym_id = my_gym_id());

-- Author-edit ONLY, even for admins/coaches - moderation is remove-only.
-- member_id/gym_id/wod_log_id retargeting blocked the same way as reactions.
CREATE POLICY "wod_log_comments_update_own" ON wod_log_comments FOR UPDATE
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid() AND gym_id = my_gym_id());

-- Author OR same-gym coach/admin (owner decision §1: coach-or-admin
-- moderation, matching the wod_log_media precedent's is_coach_or_admin(gid)
-- convention). is_coach_or_admin(gym_id) here is scoped to the ROW's own
-- gym_id, which the SELECT/INSERT policies above already pin to the
-- caller's own gym - never a caller-supplied value trusted on its own.
CREATE POLICY "wod_log_comments_delete_own_or_staff" ON wod_log_comments FOR DELETE
  USING (member_id = auth.uid() OR is_coach_or_admin(gym_id));
