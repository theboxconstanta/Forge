-- Run as postgres (the non-superuser role production migrations run as).
-- Subset of the live public schema the Events migration depends on, with the
-- live helper definitions / app_settings policies verified read-only 2026-10-14.
create table gyms (id uuid primary key, name text unique);
create table admins (id uuid, gym_id uuid);
create table coaches (id uuid, gym_id uuid);
create table profiles (id uuid primary key, gym_id uuid, email text, full_name text);
create table memberships (id uuid primary key default gen_random_uuid(), member_id uuid, gym_id uuid, status text);
create table subscriptions (
  id uuid primary key default gen_random_uuid(), gym_id uuid, member_email text,
  is_active boolean, queued boolean default false, start_date date, end_date date,
  sessions_total int, sessions_used int default 0
);
create table classes (id uuid primary key default gen_random_uuid(), gym_id uuid, name text, date date, max_spots int);
create table bookings (id uuid primary key default gen_random_uuid(), gym_id uuid, member_id uuid, class_id text, checked_in boolean default false);
create function is_admin(gid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where id = auth.uid() and gym_id = gid)
$$;
create function is_coach_or_admin(gid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_admin(gid) or exists (select 1 from coaches where id = auth.uid() and gym_id = gid)
$$;
create function my_gym_id() returns uuid language sql stable security definer set search_path = public as $$
  select gym_id from profiles where id = auth.uid()
$$;
create or replace function prevent_gym_id_change() returns trigger language plpgsql as $$
begin
  if old.gym_id is not null and new.gym_id is distinct from old.gym_id then
    raise exception 'gym_id cannot be changed after it has been set';
  end if;
  return new;
end;
$$;
create table app_settings (
  key text not null, value text, updated_at timestamptz default now(),
  gym_id uuid not null references gyms(id), primary key (gym_id, key)
);
alter table app_settings enable row level security;
create policy app_settings_admin_delete on app_settings for delete to authenticated using (is_admin(gym_id));
create policy app_settings_admin_insert on app_settings for insert to authenticated with check (is_admin(gym_id));
create policy app_settings_admin_update on app_settings for update to authenticated using (is_admin(gym_id)) with check (is_admin(gym_id));
create policy app_settings_select_all on app_settings for select to authenticated using (gym_id = my_gym_id());
alter table profiles enable row level security;
create policy profiles_select_all on profiles for select to authenticated using (id = auth.uid() or gym_id = my_gym_id());
alter table bookings enable row level security;
alter table subscriptions enable row level security;
alter table classes enable row level security;
alter table memberships enable row level security;
alter publication supabase_realtime add table classes, bookings, app_settings;
