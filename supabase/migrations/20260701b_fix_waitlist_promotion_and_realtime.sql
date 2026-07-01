-- Fixes two regressions/gaps surfaced after enabling RLS (20260701_enable_rls_core_tables.sql):
--
-- 1. Waitlist auto-booking silently failed and rolled back the promoted
--    member's booking. checkAndBookFromWaitlist (App.jsx:85) reads the
--    promoted member's CURRENT sessions_used before incrementing it, but the
--    acting member (the one who cancelled, triggering the promotion) is
--    neither the row owner nor an admin, so the SELECT policy blocked the
--    read. The app then treated the count as 0, the UPDATE's new value
--    mismatched what the anti-tamper trigger expected, and the trigger's
--    exception caused the app to roll back the just-created booking. The fix
--    mirrors the same "a booking was just created for this member" exception
--    already present on the UPDATE policy onto SELECT as well.
--
-- 2. Admins creating/deleting a class never showed up live for other members.
--    The frontend already subscribes to postgres_changes on classes/wods/
--    wod_logs (App.jsx:2658-2676), but those tables were never added to the
--    supabase_realtime publication (unlike bookings/subscriptions/
--    class_waitlist, which were - see 20260629_enable_realtime_subscriptions.sql).

DROP POLICY IF EXISTS "subscriptions_select_own_or_admin" ON subscriptions;
CREATE POLICY "subscriptions_select_own_or_admin" ON subscriptions FOR SELECT TO authenticated
  USING (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(subscriptions.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  );

ALTER TABLE classes REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'classes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE classes;
  END IF;
END $$;

ALTER TABLE wods REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wods'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wods;
  END IF;
END $$;

ALTER TABLE wod_logs REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wod_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wod_logs;
  END IF;
END $$;
