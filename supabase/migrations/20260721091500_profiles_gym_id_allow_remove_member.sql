-- P0-006: replaces the shared prevent_gym_id_change_trg on `profiles` ONLY
-- with a profiles-specific trigger allowing exactly one additional
-- transition: gym_id (non-null) -> NULL (Remove Member ending a
-- membership). The shared prevent_gym_id_change() function and its
-- triggers on the other 18 tenant-scoped tables (admins, coaches, classes,
-- wods, subscription_plans, bookings, wod_logs, personal_records,
-- skill_logs, class_waitlist, class_reminders, push_subscriptions,
-- subscriptions, feed_posts, feed_comments, feed_reactions,
-- custom_hero_wods, app_settings) are NOT touched by this migration -
-- explicit product decision, not an oversight: this business rule belongs
-- to the Membership concept (profiles.gym_id) only, nothing else has
-- received it.
--
-- The live shared trigger (confirmed via pg_proc.prosrc before writing
-- this) already only fires `if old.gym_id is not null and new.gym_id is
-- distinct from old.gym_id` - meaning NULL -> <a gym> (initial join / owner
-- bootstrap claiming a gym) was already unconditionally allowed before this
-- migration, on every table including profiles. This migration adds
-- exactly one more allowed case for profiles specifically: <a gym> -> NULL.
-- Every other transition - <a gym> -> <a different gym>, in particular -
-- remains blocked, identically to the shared trigger's own guarantee.

drop trigger prevent_gym_id_change_trg on profiles;

create or replace function prevent_profiles_gym_id_change()
returns trigger
language plpgsql
as $$
begin
  if old.gym_id is not null
     and new.gym_id is distinct from old.gym_id
     and new.gym_id is not null then
    raise exception 'gym_id cannot be changed after it has been set';
  end if;
  return new;
end;
$$;

create trigger prevent_profiles_gym_id_change_trg
before update on profiles
for each row execute function prevent_profiles_gym_id_change();

-- Rollback: drop prevent_profiles_gym_id_change_trg and
-- prevent_profiles_gym_id_change(), re-create
-- "create trigger prevent_gym_id_change_trg before update on profiles
--  for each row execute function prevent_gym_id_change()" (the shared
-- function itself was never dropped, still exists for the other 18 tables).
