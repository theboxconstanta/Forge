-- P0-006 follow-up: lets an authenticated user with no current gym
-- (profiles.gym_id = NULL - reached via Remove Member, or a genuinely
-- interrupted owner bootstrap) join a gym with a code, without needing a
-- second account. Reuses the existing membership model exactly -
-- profiles.gym_id is still the sole membership signal, no new table.
--
-- Extracts the "resolve a join code -> gym" lookup, previously duplicated
-- inline inside handle_new_user(), into a shared function used by both
-- signup and this new authenticated path - per explicit product decision,
-- not a speculative refactor. gyms.join_code has a genuine UNIQUE
-- constraint (verified live: gyms_join_code_key) - the code alone always
-- resolves to at most one gym, so neither caller needs to (or should) be
-- trusted to also supply the right gym_id.

create or replace function resolve_gym_join_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from gyms where upper(join_code) = upper(p_code) and is_active = true;
$$;

revoke all on function resolve_gym_join_code(text) from public, anon;
-- Not granted to `authenticated` either - only ever called from inside
-- other SECURITY DEFINER functions (handle_new_user, join_gym_with_code),
-- never directly via supabase.rpc(...). No PostgREST-facing grant needed.

-- handle_new_user() refactored to call the shared resolver instead of its
-- own inline duplicate of the same query - identical behavior, same error
-- message, same trigger signature. Not otherwise changed.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_code text := new.raw_user_meta_data->>'gym_join_code';
begin
  if v_code is not null and v_code <> '' then
    v_gym_id := resolve_gym_join_code(v_code);
    if v_gym_id is null then
      raise exception 'invalid gym join code';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, gym_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    v_gym_id
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name);
  return new;
end;
$$;

-- New: the authenticated-session join path. Admin-only-editable columns
-- (email, full_name, etc.) are untouched - this only ever sets gym_id, and
-- only when the caller currently has none. The existing
-- prevent_profiles_gym_id_change trigger (P0-006) is the second,
-- independent layer that would reject this if the caller somehow already
-- had a gym - defense in depth, not the only check.
create or replace function join_gym_with_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_gym_id uuid;
  v_gym_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  select gym_id into v_current_gym_id from profiles where id = auth.uid();
  if v_current_gym_id is not null then
    raise exception 'already a member of a gym';
  end if;

  v_gym_id := resolve_gym_join_code(p_code);
  if v_gym_id is null then
    raise exception 'invalid gym join code';
  end if;

  update profiles set gym_id = v_gym_id where id = auth.uid();
end;
$$;

revoke all on function join_gym_with_code(text) from public, anon;
grant execute on function join_gym_with_code(text) to authenticated;

-- Rollback: re-apply handle_new_user()'s pre-P0-006-followup body (inline
-- gym lookup, no resolve_gym_join_code call); drop join_gym_with_code and
-- resolve_gym_join_code.
