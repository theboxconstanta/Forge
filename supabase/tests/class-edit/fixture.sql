-- Isolated fixture mirroring the LIVE shapes verified 2026-10-08 (classes,
-- bookings columns; classes RLS policies; existing classes triggers). The
-- Supabase-specific pieces (auth.uid, roles, membership helpers) are stubs.
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table admins (id uuid, gym_id uuid);
create table coaches (id uuid, gym_id uuid);
create table profiles (id uuid primary key, gym_id uuid, email text);
grant select on admins, coaches, profiles to authenticated;

create function is_admin(gid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where id = auth.uid() and gym_id = gid)
$$;
create function is_coach_or_admin(gid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_admin(gid) or exists (select 1 from coaches where id = auth.uid() and gym_id = gid)
$$;
create function my_gym_id() returns uuid language sql stable security definer set search_path = public as $$
  select gym_id from profiles where id = auth.uid()
$$;

create table classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  coach text,
  max_spots integer default 12,
  created_at timestamptz default now(),
  color text,
  gym_id uuid not null
);
create index classes_gym_id_idx on classes (gym_id);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  created_at timestamptz default now(),
  class_id text,
  checked_in boolean default false,
  gym_id uuid,
  no_show boolean default false
);

alter table classes enable row level security;
alter table bookings enable row level security;
create policy classes_admin_delete on classes for delete to authenticated using (is_coach_or_admin(gym_id));
create policy classes_admin_insert on classes for insert to authenticated with check (is_coach_or_admin(gym_id));
create policy classes_admin_update on classes for update to authenticated using (is_coach_or_admin(gym_id)) with check (is_coach_or_admin(gym_id));
create policy classes_select_all on classes for select to authenticated using (gym_id = my_gym_id());
create policy bookings_select_all on bookings for select to authenticated using (gym_id = my_gym_id());
grant select, insert, update, delete on classes, bookings to authenticated;

-- Existing live triggers (copied from their migrations).
create or replace function enforce_class_capacity_on_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if new.max_spots is not null and new.max_spots is distinct from old.max_spots then
    select count(*) into v_count from bookings where class_id = old.id::text;
    if new.max_spots < v_count then
      raise exception 'cannot set capacity to % - % member(s) already booked', new.max_spots, v_count;
    end if;
  end if;
  return new;
end; $$;
create trigger classes_enforce_capacity_on_update_trg before update on classes
  for each row execute function enforce_class_capacity_on_update();

create or replace function prevent_gym_id_change() returns trigger language plpgsql as $$
begin
  if new.gym_id is distinct from old.gym_id then raise exception 'gym_id cannot be changed'; end if;
  return new;
end; $$;
create trigger prevent_gym_id_change_trg before update on classes
  for each row execute function prevent_gym_id_change();

CREATE OR REPLACE FUNCTION enforce_class_deletion_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_booking_count int; v_checked_in_count int; v_class_ended boolean;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE checked_in) INTO v_booking_count, v_checked_in_count
    FROM bookings WHERE class_id = OLD.id::text;
  IF v_booking_count = 0 THEN RETURN OLD; END IF;
  IF v_checked_in_count > 0 THEN
    RAISE EXCEPTION 'cannot delete this class: % booking(s) have recorded attendance (checked_in) - this would destroy attendance history', v_checked_in_count;
  END IF;
  v_class_ended := ((OLD.date + OLD.end_time) AT TIME ZONE 'Europe/Bucharest') < now();
  IF v_class_ended THEN
    RAISE EXCEPTION 'cannot delete a past class with % existing booking(s) - this would destroy historical attendance data', v_booking_count;
  END IF;
  DELETE FROM bookings WHERE class_id = OLD.id::text;
  RETURN OLD;
END; $$;
create trigger classes_enforce_deletion_policy_trg before delete on classes
  for each row execute function enforce_class_deletion_policy();
