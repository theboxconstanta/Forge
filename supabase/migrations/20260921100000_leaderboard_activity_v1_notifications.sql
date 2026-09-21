-- LEADERBOARD ACTIVITY V1 - PERSONAL SOCIAL NOTIFICATIONS. Owner-approved
-- forensic + decisions (Leaderboard Activity V1 ticket, 2026-09-21). New
-- Results Indicator explicitly DEFERRED to V2 - this migration is
-- reactions/comments notifications ONLY. No change to any existing table
-- except the notification rows this one creates.
--
-- DESIGN: notification creation happens EXCLUSIVELY server-side, via
-- triggers reacting to the already-RLS-protected wod_log_reactions/
-- wod_log_comments tables. Clients have NO INSERT and NO DELETE grant path
-- at all on leaderboard_notifications (no permissive RLS policy for either
-- command - the narrowest possible mechanism against forged notification
-- rows, stronger than a client-callable RPC). Recipient UPDATE is further
-- restricted at the COLUMN level to read_at only (REVOKE/GRANT below), so
-- even a member updating their OWN row cannot rewrite who it's from, what
-- it's about, or when it happened.
--
-- REACTIONS: wod_log_reactions already enforces exactly one row per
-- (wod_log_id, member_id) - swapping emoji is an UPDATE of that SAME row,
-- never a new one. The notification table mirrors this 1:1 via
-- UNIQUE(reaction_id): the trigger UPSERTs keyed on reaction_id, so a swap
-- updates the existing notification (new emoji, bumped created_at,
-- read_at reset to unread) instead of creating a second one. Deleting the
-- reaction cascades (ON DELETE CASCADE via reaction_id) and removes the
-- notification automatically - no DELETE trigger needed.
--
-- COMMENTS: one notification per real comment (UNIQUE(comment_id)),
-- created ONLY on INSERT - the trigger is intentionally not registered on
-- UPDATE at all, so editing a comment structurally cannot create (or
-- touch) a notification. Deleting the comment cascades the same way.
--
-- CROSS-GYM INTEGRITY: same composite-FK mechanism as Social V1 -
-- (wod_log_id, gym_id) references wod_logs(id, gym_id), which that
-- migration already added as a UNIQUE constraint. gym_id is taken directly
-- from the reaction/comment row (NEW.gym_id), which Social V1's own
-- composite FK already guarantees matches the target wod_log's real
-- gym_id - no separate re-derivation needed.

CREATE TABLE IF NOT EXISTS leaderboard_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wod_log_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reaction', 'comment')),
  reaction_id uuid NULL REFERENCES wod_log_reactions(id) ON DELETE CASCADE,
  comment_id uuid NULL REFERENCES wod_log_comments(id) ON DELETE CASCADE,
  emoji text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL,
  CONSTRAINT leaderboard_notifications_kind_ref_check CHECK (
    (kind = 'reaction' AND reaction_id IS NOT NULL AND comment_id IS NULL) OR
    (kind = 'comment'  AND comment_id  IS NOT NULL AND reaction_id IS NULL)
  ),
  CONSTRAINT leaderboard_notifications_reaction_unique UNIQUE (reaction_id),
  CONSTRAINT leaderboard_notifications_comment_unique UNIQUE (comment_id),
  CONSTRAINT leaderboard_notifications_log_gym_fkey FOREIGN KEY (wod_log_id, gym_id)
    REFERENCES wod_logs(id, gym_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS leaderboard_notifications_recipient_unread_idx ON leaderboard_notifications(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS leaderboard_notifications_recipient_created_idx ON leaderboard_notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leaderboard_notifications_gym_idx ON leaderboard_notifications(gym_id);
CREATE INDEX IF NOT EXISTS leaderboard_notifications_log_idx ON leaderboard_notifications(wod_log_id);

ALTER TABLE leaderboard_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leaderboard_notifications_select_own" ON leaderboard_notifications;
DROP POLICY IF EXISTS "leaderboard_notifications_update_own" ON leaderboard_notifications;

CREATE POLICY "leaderboard_notifications_select_own" ON leaderboard_notifications FOR SELECT
  USING (recipient_id = auth.uid());

-- Mark-as-read only. No INSERT policy, no DELETE policy anywhere below -
-- RLS default-denies both for every client role; the trigger functions
-- (SECURITY DEFINER, run as table owner) are the ONLY writer, bypassing
-- RLS on their own inserts the ordinary Postgres way (owner-context
-- writes are not subject to the table's own RLS unless FORCE ROW LEVEL
-- SECURITY is set, which is deliberately NOT set here).
CREATE POLICY "leaderboard_notifications_update_own" ON leaderboard_notifications FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Column-scoped UPDATE (owner decision: "Restrict UPDATE to read_at") -
-- RLS alone cannot distinguish which columns a client changes, so even a
-- recipient updating their OWN row must be blocked at the GRANT layer from
-- rewriting who it's from, what it's about, or when it happened.
REVOKE UPDATE ON leaderboard_notifications FROM authenticated;
GRANT UPDATE (read_at) ON leaderboard_notifications TO authenticated;

-- ==========================================================================
-- REACTION NOTIFICATIONS - upsert keyed on reaction_id (1:1 with the
-- reaction row). Fires on INSERT (new reaction) and UPDATE (emoji swap);
-- DELETE is handled by the FK's ON DELETE CASCADE above, no trigger needed.
-- ==========================================================================

CREATE OR REPLACE FUNCTION leaderboard_notify_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient uuid;
BEGIN
  SELECT member_id INTO v_recipient FROM wod_logs WHERE id = NEW.wod_log_id;
  -- No owner on the target log, or reacting to your OWN result - no
  -- notification (owner decision: never notify on your own action).
  IF v_recipient IS NULL OR v_recipient = NEW.member_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO leaderboard_notifications (gym_id, recipient_id, actor_id, wod_log_id, kind, reaction_id, emoji, created_at, read_at)
  VALUES (NEW.gym_id, v_recipient, NEW.member_id, NEW.wod_log_id, 'reaction', NEW.id, NEW.emoji, now(), NULL)
  ON CONFLICT (reaction_id) DO UPDATE SET
    emoji = EXCLUDED.emoji,
    created_at = now(),
    read_at = NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wod_log_reactions_notify ON wod_log_reactions;
CREATE TRIGGER wod_log_reactions_notify
  AFTER INSERT OR UPDATE ON wod_log_reactions
  FOR EACH ROW EXECUTE FUNCTION leaderboard_notify_reaction();

-- ==========================================================================
-- COMMENT NOTIFICATIONS - one row per real comment, INSERT only. No
-- trigger registered on UPDATE at all, so editing a comment structurally
-- cannot create (or touch) a notification. DELETE cascades via FK.
-- ==========================================================================

CREATE OR REPLACE FUNCTION leaderboard_notify_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient uuid;
BEGIN
  SELECT member_id INTO v_recipient FROM wod_logs WHERE id = NEW.wod_log_id;
  IF v_recipient IS NULL OR v_recipient = NEW.member_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO leaderboard_notifications (gym_id, recipient_id, actor_id, wod_log_id, kind, comment_id, created_at, read_at)
  VALUES (NEW.gym_id, v_recipient, NEW.member_id, NEW.wod_log_id, 'comment', NEW.id, now(), NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wod_log_comments_notify ON wod_log_comments;
CREATE TRIGGER wod_log_comments_notify
  AFTER INSERT ON wod_log_comments
  FOR EACH ROW EXECUTE FUNCTION leaderboard_notify_comment();
