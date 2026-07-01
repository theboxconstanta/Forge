-- class_reminders had RLS enabled but zero policies (pre-existing, not from
-- today's RLS work), so every member-initiated reminder upsert/delete has
-- always failed silently (these calls are fire-and-forget, no error surfaced
-- to the user) - meaning class reminders effectively never got set from the
-- app. Access patterns in App.jsx:
--   - member sets/removes their OWN reminder when booking/cancelling a class
--     (App.jsx:3144,3161)
--   - admin sets/removes a reminder when adding/removing a member from a
--     class on their behalf (App.jsx:1193,1222)
--   - the waitlist auto-book flow sets a reminder for the member it just
--     promoted (App.jsx:96) - acting user isn't the owner or admin, but a
--     booking was just created for that member moments earlier, same
--     exception used for subscriptions.
-- A SELECT policy is required even though the frontend never reads this
-- table directly: Postgres RLS needs a SELECT policy to evaluate ON CONFLICT
-- clauses (the upsert calls all use onConflict: 'class_id,member_email'),
-- and fails the whole statement without one - confirmed by testing, this
-- broke even a member's own-row upsert with zero pre-existing conflicts.

DROP POLICY IF EXISTS "class_reminders_select_own_or_admin_or_recent_booking" ON class_reminders;
DROP POLICY IF EXISTS "class_reminders_insert_own_or_admin_or_recent_booking" ON class_reminders;
DROP POLICY IF EXISTS "class_reminders_update_own_or_admin_or_recent_booking" ON class_reminders;
DROP POLICY IF EXISTS "class_reminders_delete_own_or_admin" ON class_reminders;

CREATE POLICY "class_reminders_select_own_or_admin_or_recent_booking" ON class_reminders FOR SELECT TO authenticated
  USING (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(class_reminders.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  );

CREATE POLICY "class_reminders_insert_own_or_admin_or_recent_booking" ON class_reminders FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(class_reminders.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  );

CREATE POLICY "class_reminders_update_own_or_admin_or_recent_booking" ON class_reminders FOR UPDATE TO authenticated
  USING (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(class_reminders.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  )
  WITH CHECK (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(class_reminders.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  );

CREATE POLICY "class_reminders_delete_own_or_admin" ON class_reminders FOR DELETE TO authenticated
  USING (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
  );
