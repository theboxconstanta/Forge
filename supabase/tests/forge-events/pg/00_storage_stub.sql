-- Run as supabase_admin in a DISPOSABLE local container only.
-- The supabase/postgres image ships the storage schema but not its tables
-- (those come from the storage-api service). Shape modelled on storage-api;
-- ownership/grants follow the 2026-06-28 and 2026-09-05 repo migrations that
-- created buckets + storage.objects policies in production with the same
-- statements. protect_delete below is copied from the live definition
-- (read-only production catalog preflight, 2026-10-14).
create table storage.buckets (
  id text primary key, name text not null unique, owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], type text default 'STANDARD'
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb, version text, user_metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end;
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true), ('wod-photos', 'wod-photos', false);

create or replace function storage.protect_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
  end if;
  return null;
end;
$$;
create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
