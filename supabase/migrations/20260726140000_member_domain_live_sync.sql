-- M1.4.1 - Member Domain Live Synchronization
--
-- Closes the drift gap identified going into M1.4: M1.3 backfilled
-- members/memberships as a one-time snapshot. Every profiles write
-- since then - and every one going forward - has had no effect on
-- members/memberships at all.
--
-- Entry-point analysis (verified against the live schema and every
-- Edge Function/RPC/trigger in this repository):
--   - handle_new_user() (trigger on auth.users) creates profiles, and
--     optionally sets gym_id at the same moment if a join code was
--     supplied at signup.
--   - join_gym_with_code() (RPC) sets gym_id on an existing,
--     currently-gym-less profile - the rejoin/late-join path, per its
--     own migration's comment ("reached via Remove Member, or a
--     genuinely interrupted owner bootstrap").
--   - The gym-owner bootstrap flow (src/App.jsx) issues a plain,
--     direct `.from('profiles').update({ gym_id: newGymId })` from the
--     client - not through any RPC or Edge Function.
--   - admin-remove-member (Edge Function) issues a plain, direct
--     `.from('profiles').update({ gym_id: null })`.
--
-- Because gym_id changes through at least three structurally different
-- call sites - and any future one would take the same shape, a plain
-- UPDATE against profiles - the only synchronization point that can
-- never be silently bypassed is a trigger on `profiles` itself, not a
-- wrapper added to each individual call site. Extending
-- handle_new_user() alone would miss join_gym_with_code() and the
-- owner-bootstrap update entirely.
--
-- Scope boundary, explicit: this synchronizes only the two drift
-- vectors M1.4.1 names - creation (a profiles row appearing) and
-- membership start/end (gym_id transitioning to/from NULL). It does
-- NOT propagate later edits to identity fields (name, avatar, waiver,
-- etc.) on an already-existing profile - the Member Portal still
-- writes those to profiles only, unchanged, exactly as required ("do
-- not migrate frontend read paths yet"). This is a scope boundary, not
-- an oversight.
--
-- Failure isolation follows this codebase's own existing precedent
-- (notify_visibility_change(), M13.x): a Member Domain sync failure
-- must never block the primary write to profiles/auth.users. Every
-- sync operation is wrapped in exception handling that logs a WARNING
-- and continues, rather than aborting the signup, join, or removal
-- that triggered it.

-- Shared helper: mirrors one profiles row into members, exactly per
-- the approved M1.2 column mapping. SECURITY DEFINER so it can write to
-- members regardless of the calling role's own RLS-restricted
-- permissions - members/memberships have RLS enabled with zero
-- policies (M1.1); running as owner (postgres) is exempt from RLS by
-- default, the same mechanism handle_new_user() already relies on to
-- write to profiles on behalf of a new signup.
create or replace function sync_member_from_profile(p_profile profiles)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into members (id, email, full_name, avatar_url, created_at, gender, first_name, last_name, birth_date, weight_unit, language)
  values (p_profile.id, p_profile.email, p_profile.full_name, p_profile.avatar_url, p_profile.created_at, p_profile.gender, p_profile.first_name, p_profile.last_name, p_profile.birth_date, p_profile.weight_unit, p_profile.language)
  on conflict (id) do nothing;
end;
$$;

-- Fires once per genuinely new profiles row. handle_new_user()'s own
-- "on conflict (id) do update" path does not re-fire this - a conflict
-- is an UPDATE for trigger purposes, and that path only ever touches
-- email/full_name, never gym_id.
create or replace function member_domain_sync_on_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sync_member_from_profile(new);

  if new.gym_id is not null then
    insert into memberships (id, member_id, gym_id, status, created_at, waiver_accepted, waiver_accepted_at)
    select gen_random_uuid(), new.id, new.gym_id, 'active', new.created_at, new.waiver_accepted, new.waiver_accepted_at
    where not exists (
      select 1 from memberships m where m.member_id = new.id and m.gym_id = new.gym_id and m.status = 'active'
    );
  end if;

  return new;
exception when others then
  raise warning 'member_domain_sync_on_profile_insert failed for profile %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger member_domain_sync_insert_trg
  after insert on profiles
  for each row execute function member_domain_sync_on_profile_insert();

-- Fires only when gym_id actually changes value - covers every current
-- call site that sets or clears it (join_gym_with_code, the
-- owner-bootstrap direct update, admin-remove-member), and any future
-- one that writes to profiles.gym_id the same way, without requiring
-- this trigger to be touched again.
create or replace function member_domain_sync_on_profile_gym_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sync_member_from_profile(new);

  if old.gym_id is null and new.gym_id is not null then
    -- Join or rejoin. A rejoin is a new Membership, never a
    -- reactivation of an old one (Member Domain Architecture Section
    -- 7.1) - no guard against a prior membership existing for this
    -- member, only against re-firing this exact transition twice.
    insert into memberships (id, member_id, gym_id, status, created_at, waiver_accepted, waiver_accepted_at)
    select gen_random_uuid(), new.id, new.gym_id, 'active', now(), new.waiver_accepted, new.waiver_accepted_at
    where not exists (
      select 1 from memberships m where m.member_id = new.id and m.gym_id = new.gym_id and m.status = 'active'
    );
  elsif old.gym_id is not null and new.gym_id is null then
    -- Removal. Ends the active Membership at the Gym just left -
    -- terminal, per Member Domain Architecture Section 7.1 - never
    -- deleted, never reused.
    update memberships
    set status = 'removed'
    where member_id = new.id and gym_id = old.gym_id and status = 'active';
  end if;

  return new;
exception when others then
  raise warning 'member_domain_sync_on_profile_gym_change failed for profile %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger member_domain_sync_gym_change_trg
  after update of gym_id on profiles
  for each row
  when (old.gym_id is distinct from new.gym_id)
  execute function member_domain_sync_on_profile_gym_change();
