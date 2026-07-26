-- M1.4.3 - Member Domain Identity Field Synchronization
--
-- Closes the regression the M1.4 Read Path Migration exposed:
-- sync_member_from_profile() (M1.4.1) only ever INSERTs into members
-- (ON CONFLICT (id) DO NOTHING), and the only two triggers on profiles
-- that call it fire on INSERT (new signup) or on UPDATE OF gym_id
-- (join/leave). Neither fires for an identity edit on an already-existing
-- profile - full_name, avatar_url, gender, first_name, last_name,
-- birth_date, weight_unit, language, all written exclusively by Member
-- Portal (App.jsx: saveProfile, saveOnboarding, saveMyProfile,
-- changeWeightUnit, changeLanguage, uploadAvatar). Every read path M1.4
-- migrated onto members (Feed, Leaderboard, Admin roster, Admin class
-- roster, "who else is booked") therefore kept showing the member's
-- at-signup identity forever, with no automatic repair - exactly the
-- 'member_field_drift' issue type M1.4.1b's own reconciliation view
-- already names and classifies as auto_repairable, but reconcile_member_
-- domain() is manual-only, invoked by a platform admin, never scheduled.
--
-- Scope boundary, explicit: this closes exactly that gap. It does not
-- touch gym_id semantics or Membership creation/termination -
-- member_domain_sync_gym_change_trg and its active/removed logic are
-- untouched, byte-for-byte, by this migration. It does not touch RLS,
-- Financial Domain, or any frontend write path - profiles remains the
-- only table the frontend ever writes to.
--
-- Rollback: drop trigger member_domain_sync_identity_change_trg on
-- profiles; drop function member_domain_sync_on_profile_identity_change();
-- restore sync_member_from_profile()'s prior body (ON CONFLICT (id) DO
-- NOTHING, no DO UPDATE clause).

-- Widen the one function that has ever written to members so an existing
-- row's identity fields are refreshed from profiles, not just created
-- once. created_at is deliberately excluded from the UPDATE SET list -
-- it is the Member's original creation timestamp, not a mutable identity
-- field, and must never be overwritten by a later profile edit. id and
-- gym_id are likewise excluded: id is the conflict key, gym_id is
-- member_domain_sync_gym_change_trg's exclusive concern.
create or replace function sync_member_from_profile(p_profile profiles)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into members (id, email, full_name, avatar_url, created_at, gender, first_name, last_name, birth_date, weight_unit, language)
  values (p_profile.id, p_profile.email, p_profile.full_name, p_profile.avatar_url, p_profile.created_at, p_profile.gender, p_profile.first_name, p_profile.last_name, p_profile.birth_date, p_profile.weight_unit, p_profile.language)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    gender = excluded.gender,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = excluded.birth_date,
    weight_unit = excluded.weight_unit,
    language = excluded.language;
end;
$$;

-- New, additive trigger: fires only when an identity field actually
-- changes value (the WHEN clause), and only for the exact column set
-- member_field_drift already treats as the identity surface - never on a
-- bare gym_id transition, which member_domain_sync_gym_change_trg already
-- owns and continues to own, unchanged. Same failure-isolation discipline
-- as every other M1.4.1 sync trigger: a sync failure logs a WARNING and
-- never blocks the Member Portal's write to profiles.
create or replace function member_domain_sync_on_profile_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sync_member_from_profile(new);
  return new;
exception when others then
  raise warning 'member_domain_sync_on_profile_identity_change failed for profile %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- DROP + CREATE (not CREATE OR REPLACE TRIGGER) to match this repo's
-- existing convention for re-runnable trigger migrations (see
-- notify_member_removed_visibility in 20260724070100).
drop trigger if exists member_domain_sync_identity_change_trg on profiles;

create trigger member_domain_sync_identity_change_trg
  after update of email, full_name, avatar_url, gender, first_name, last_name, birth_date, weight_unit, language on profiles
  for each row
  when (
    old.email is distinct from new.email
    or old.full_name is distinct from new.full_name
    or old.avatar_url is distinct from new.avatar_url
    or old.gender is distinct from new.gender
    or old.first_name is distinct from new.first_name
    or old.last_name is distinct from new.last_name
    or old.birth_date is distinct from new.birth_date
    or old.weight_unit is distinct from new.weight_unit
    or old.language is distinct from new.language
  )
  execute function member_domain_sync_on_profile_identity_change();
