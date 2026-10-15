-- Isolated fixture for the FORGE EVENTS Phase 1 migration. Mirrors the LIVE
-- shapes verified read-only on 2026-10-14 (app_settings PK/policies/grants,
-- prevent_gym_id_change, my_gym_id / is_admin / is_coach_or_admin,
-- storage.buckets / storage.objects / storage.foldername, the
-- supabase_realtime publication). Supabase-only pieces (auth.uid, roles)
-- are stubs. No network, no production data.
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;

-- Supabase's default privileges: every new table/function in public is
-- granted to anon + authenticated. The migration must revoke explicitly -
-- this makes the tests prove it does.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

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

-- live definition (verified 2026-10-14)
create or replace function prevent_gym_id_change() returns trigger language plpgsql as $$
begin
  if old.gym_id is not null and new.gym_id is distinct from old.gym_id then
    raise exception 'gym_id cannot be changed after it has been set';
  end if;
  return new;
end;
$$;

-- app_settings: live columns, PK, policies and (broad) grants.
create table app_settings (
  key text not null,
  value text,
  updated_at timestamptz default now(),
  gym_id uuid not null references gyms(id),
  primary key (gym_id, key)
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

-- storage (live columns subset + live foldername semantics)
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end;
$$;
grant execute on function storage.foldername(text) to anon, authenticated;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true), ('wod-photos', 'wod-photos', false);

create publication supabase_realtime;
alter publication supabase_realtime add table classes, bookings, app_settings;
