-- M1.3 - Member Domain Backfill: pre-flight validation + backfill (Step 2 of 2)
--
-- Implements the approved M1.2 Backfill Mapping Specification exactly,
-- including the Finding 1-3 revisions: Membership status is 'active'
-- (Member Domain Architecture Section 7.1, entered via "Membership
-- creation"); blank/duplicate email handling is whole-run abort, not
-- per-row skip; every Pre-flight Validation check from the approved
-- specification runs before any INSERT.
--
-- The entire block below is one statement. If any pre-flight check
-- fails, RAISE EXCEPTION aborts it in full - Postgres rolls back
-- everything the block did, including any INSERT already attempted, as
-- a single atomic unit. Nothing is committed unless every check passes.
--
-- Idempotency: the members INSERT is guarded by ON CONFLICT (id) DO
-- NOTHING; the memberships INSERT is guarded by a NOT EXISTS check on
-- member_id, per M1.2 Section 3, Row Creation Rule 9. Re-running this
-- migration after a complete prior success finds nothing left to
-- insert and is a safe no-op - see the pre-existing-state check below,
-- which recognizes a complete prior run rather than treating it as an
-- error.

do $$
declare
  v_errors text := '';
  v_dup_ids int;
  v_dup_emails int;
  v_blank_emails int;
  v_null_emails int;
  v_bad_auth_refs int;
  v_bad_gym_refs int;
  v_existing_members int;
  v_existing_memberships int;
  v_total_profiles int;
  v_gym_profiles int;
  v_null_gym_profiles int;
begin
  -- Pre-flight check 1: duplicate profiles.id (defensive; PK-enforced)
  select count(*) - count(distinct id) into v_dup_ids from profiles;
  if v_dup_ids > 0 then
    v_errors := v_errors || format(E'\n- %s duplicate profiles.id value(s) found', v_dup_ids);
  end if;

  -- Pre-flight check 2: duplicate non-blank emails
  select count(*) into v_dup_emails
  from (
    select lower(email) from profiles where email <> '' group by lower(email) having count(*) > 1
  ) d;
  if v_dup_emails > 0 then
    v_errors := v_errors || format(E'\n- %s duplicate non-blank email value(s) found', v_dup_emails);
  end if;

  -- Pre-flight check 3: blank emails (abort if more than one - would
  -- collide on members.UNIQUE(email))
  select count(*) into v_blank_emails from profiles where email = '';
  if v_blank_emails > 1 then
    v_errors := v_errors || format(E'\n- %s blank-email profiles row(s) found; members.UNIQUE(email) permits at most 1', v_blank_emails);
  end if;

  -- Pre-flight check 4: invalid auth.users references (defensive; FK-enforced)
  select count(*) into v_bad_auth_refs
  from profiles p where not exists (select 1 from auth.users u where u.id = p.id);
  if v_bad_auth_refs > 0 then
    v_errors := v_errors || format(E'\n- %s profiles row(s) with no matching auth.users row', v_bad_auth_refs);
  end if;

  -- Pre-flight check 5: invalid gym references (defensive; FK-enforced)
  select count(*) into v_bad_gym_refs
  from profiles p where p.gym_id is not null and not exists (select 1 from gyms g where g.id = p.gym_id);
  if v_bad_gym_refs > 0 then
    v_errors := v_errors || format(E'\n- %s profiles row(s) with a gym_id not present in gyms', v_bad_gym_refs);
  end if;

  -- Pre-flight check 9: unexpected NULL where prohibited (defensive; NOT NULL-enforced)
  select count(*) into v_null_emails from profiles where email is null;
  if v_null_emails > 0 then
    v_errors := v_errors || format(E'\n- %s profiles row(s) with a NULL email', v_null_emails);
  end if;

  -- Pre-flight check 10: row-count sanity
  select count(*) into v_total_profiles from profiles;
  select count(*) into v_gym_profiles from profiles where gym_id is not null;
  select count(*) into v_null_gym_profiles from profiles where gym_id is null;
  if v_total_profiles <> (v_gym_profiles + v_null_gym_profiles) then
    v_errors := v_errors || format(E'\n- row-count sanity check failed: total (%s) <> gym_id-populated (%s) + gym_id-null (%s)', v_total_profiles, v_gym_profiles, v_null_gym_profiles);
  end if;

  -- Pre-flight check 8: pre-existing state of members/memberships.
  -- Empty is the expected first-run state. Non-empty is only accepted
  -- if it exactly matches the result of a complete prior run of this
  -- same backfill (idempotent re-run) - otherwise it indicates a
  -- partial or unexplained prior write and aborts, per M1.2.
  select count(*) into v_existing_members from members;
  select count(*) into v_existing_memberships from memberships;
  if v_existing_members > 0 or v_existing_memberships > 0 then
    if v_existing_members = v_total_profiles and v_existing_memberships = v_gym_profiles then
      raise notice 'members/memberships already match the expected result of a complete prior run (% members, % memberships) - this run will be an idempotent no-op.', v_existing_members, v_existing_memberships;
    else
      v_errors := v_errors || format(E'\n- members/memberships are non-empty but do not match a complete prior run (found %s members, %s memberships; expected either 0/0 or %s/%s)', v_existing_members, v_existing_memberships, v_total_profiles, v_gym_profiles);
    end if;
  end if;

  raise notice 'M1.3 pre-flight summary: % total profiles, % with gym_id, % without gym_id, % blank emails, % duplicate emails, % existing members rows, % existing memberships rows.',
    v_total_profiles, v_gym_profiles, v_null_gym_profiles, v_blank_emails, v_dup_emails, v_existing_members, v_existing_memberships;

  if v_errors <> '' then
    raise exception E'M1.3 pre-flight validation failed - zero rows inserted:%', v_errors;
  end if;

  -- Backfill: members. One row per profiles row (Row Creation Rule 1).
  insert into members (id, email, full_name, avatar_url, created_at, gender, first_name, last_name, birth_date, weight_unit, language)
  select id, email, full_name, avatar_url, created_at, gender, first_name, last_name, birth_date, weight_unit, language
  from profiles
  on conflict (id) do nothing;

  -- Backfill: memberships. Only where gym_id is populated (Row Creation
  -- Rule 2). status = 'active' (Membership Status finding). created_at
  -- copied from the same source event (Row Creation Rules 1/3 note).
  insert into memberships (id, member_id, gym_id, status, created_at, waiver_accepted, waiver_accepted_at)
  select gen_random_uuid(), p.id, p.gym_id, 'active', p.created_at, p.waiver_accepted, p.waiver_accepted_at
  from profiles p
  where p.gym_id is not null
    and not exists (select 1 from memberships m where m.member_id = p.id);
end $$;
