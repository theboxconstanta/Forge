-- M1.5.5 - Member Domain: identity bridge retirement
--
-- Pure infrastructure cleanup, no behavioral change. Removes the one
-- remaining piece of infrastructure whose entire purpose was propagating
-- Member identity from profiles to members - already fully neutralized by
-- M1.5.4's narrowing of sync_member_from_profile() to create-if-missing
-- only, and confirmed by repository-wide audit to have zero remaining
-- production callers and zero effect when it fires.
--
-- Not touched, and explicitly out of scope (per the approved M1.5.5
-- design review):
--   - member_field_drift (member_domain_consistency_detail, issue 3):
--     no longer identity-propagation infrastructure since M1.5.4 - its
--     purpose is now diagnostic observability, the same category as
--     member_orphaned/member_duplicate_email. Removing it would be
--     re-litigating an M1.5.4 decision, not retiring dead infrastructure.
--   - handle_new_user(): never itself bridge infrastructure - it writes to
--     profiles for Authentication's own reasons; the propagation mechanism
--     it used to feed is what this migration removes, not its own write.
--   - member_domain_sync_gym_change_trg, member_domain_sync_on_profile_
--     gym_change(), member_domain_sync_insert_trg,
--     member_domain_sync_on_profile_insert(), sync_member_from_profile():
--     all still live and necessary (signup, Membership lifecycle,
--     reconciliation's member_missing repair) - untouched.
--
-- Rollback: re-create member_domain_sync_identity_change_trg and
-- member_domain_sync_on_profile_identity_change() exactly as defined in
-- 20260726190000; restore sync_member_from_profile(profiles)'s original
-- M1.4.1-era comment from 20260726160000.

-- Drop the trigger before the function it points to (required ordering -
-- Postgres will not drop a function a live trigger still references).
drop trigger member_domain_sync_identity_change_trg on profiles;

drop function member_domain_sync_on_profile_identity_change();

-- Correct the one stale piece of live documentation this retirement
-- leaves behind: this comment has said "Mirrors one profiles row into
-- members" since M1.4.1, which stopped being true the moment M1.5.4
-- narrowed this function to create-if-missing only. Documentation-only,
-- no execution path.
comment on function sync_member_from_profile(profiles) is
  'M1.5.4. Creates a members row from a profiles row only if one does not already exist (INSERT ... ON CONFLICT DO NOTHING) - never overwrites. Called by the signup trigger, the gym-change trigger''s defensive FK-safety need, and reconciliation''s member_missing repair. Does not, and must never again, refresh an existing row''s identity fields from profiles - profiles is not the identity Source of Truth.';
