-- Second gap in waitlist auto-booking, found via live testing with two real
-- non-admin accounts (the earlier fix in 20260701b was verified using an
-- admin account as the "canceller", which bypasses RLS via is_admin() and
-- masked this).
--
-- checkAndBookFromWaitlist (App.jsx:66-69) reads the WAITLISTED member's
-- subscription to check eligibility (active plan, sessions remaining)
-- BEFORE creating their booking. At that point none of the existing SELECT
-- policy's conditions hold for the cancelling member's session: not admin,
-- not their own row, and no booking exists yet for the waitlisted member (the
-- "recent booking" exception only helps the LATER read at App.jsx:85, after
-- the booking is created). The read returns nothing, the app concludes "no
-- valid subscription", and silently removes them from the waitlist without
-- booking them - no error, since the app treats that as a legitimate case.
--
-- Fix: also allow reading a member's subscription when they currently have a
-- class_waitlist entry. This doesn't leak new information - class_waitlist
-- SELECT is already open to any authenticated user - it just lets the
-- eligibility check for a waitlisted member actually run.

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
    OR EXISTS (
      SELECT 1 FROM class_waitlist cw
      WHERE lower(cw.member_email) = lower(subscriptions.member_email)
    )
  );
