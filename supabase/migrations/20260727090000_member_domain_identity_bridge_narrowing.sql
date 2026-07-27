-- M1.5.4 - Member Domain: identity bridge narrowing
--
-- Closes two repository-proven regressions, both traced to the same root
-- cause: sync_member_from_profile() was widened in M1.4.3 from create-only
-- (INSERT ... ON CONFLICT DO NOTHING) to create-or-refresh (... DO UPDATE),
-- for the identity-change trigger's sake, at a time when profiles was
-- still the identity write target. Since M1.5.3 moved identity writes to
-- members, profiles' identity columns are frozen - but two other callers
-- of the same widened function kept re-applying that frozen snapshot on
-- top of fresher members data:
--
-- Finding 1: member_domain_sync_on_profile_gym_change() unconditionally
-- calls sync_member_from_profile(new) on every gym_id change (join,
-- rejoin, removal). Its DO UPDATE branch silently reverted any identity
-- edit a member had made since M1.5.3, every time they joined, left, or
-- were removed from a gym.
--
-- Finding 2: reconcile_member_domain()'s member_field_drift branch
-- (issue 3) repaired members by overwriting it from profiles whenever
-- they differed - the manual-invocation twin of Finding 1, structurally
-- identical, just admin-triggered instead of automatic.
--
-- Empirically proven, separately from the above: sync_member_from_profile()
-- carried EXECUTE for anon/authenticated/PUBLIC with no internal auth.uid()
-- check - confirmed exploitable via a real, live, unauthenticated
-- POST /rest/v1/rpc/sync_member_from_profile request (HTTP 409, Postgres
-- error 23503, proving the request reached the INSERT statement). This is
-- observed fact, not inference; that a real member's id would complete the
-- write (return 200/204) is the one inferred, not directly observed, part
-- of that finding - deduced from the same mechanics, never itself executed.
--
-- Scope boundary, explicit: this migration corrects behavior inside
-- functions that remain live and necessary. It does not drop
-- member_domain_sync_identity_change_trg, its dedicated wrapper function,
-- or the member_field_drift view case - those are now provably inert
-- (see below) but their removal is deferred infrastructure cleanup, not
-- this phase's concern. No trigger definition, no table, no RLS policy,
-- no Financial Domain or Membership Domain object is touched.
--
-- Rollback: re-apply sync_member_from_profile() and reconcile_member_domain()
-- exactly as defined in 20260726190000 and 20260726150000 respectively;
-- re-apply member_domain_consistency_detail exactly as defined in
-- 20260726150000; GRANT EXECUTE ON FUNCTION sync_member_from_profile(profiles)
-- TO anon, authenticated (not recommended, but mechanically sufficient).

-- 1. Narrow sync_member_from_profile() to create-if-missing only. Every
-- remaining legitimate caller (the insert trigger, this same gym-change
-- trigger's defensive FK-safety need, and reconciliation's member_missing
-- repair) only ever needs "bring a members row into existence if absent" -
-- never "overwrite an existing one." This is the function's original
-- M1.4.1 shape, before M1.4.3 widened it for a need (the identity-change
-- trigger's production role) that no longer exists.
--
-- A direct, structural consequence of this one change: it also closes
-- Finding 1 without touching member_domain_sync_on_profile_gym_change()'s
-- own body at all. That function's only identity-adjacent line,
-- `perform sync_member_from_profile(new);`, is unchanged - what changes is
-- entirely what that call now does. Its membership join/leave/removal
-- logic is untouched by this migration, byte-for-byte (verify by diffing
-- against 20260726140000 - no lines in that function change here).
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

-- 2. Close the proven, unauthenticated direct-RPC exposure. Internal
-- callers (the three SECURITY DEFINER trigger/RPC contexts already
-- calling this function) run as this function's owner regardless of
-- grants on the calling role - revoking anon/authenticated/PUBLIC access
-- does not affect them. Nothing in this repository ever needed a client
-- to call this function directly.
revoke execute on function sync_member_from_profile(profiles) from public;
revoke execute on function sync_member_from_profile(profiles) from anon;
revoke execute on function sync_member_from_profile(profiles) from authenticated;

-- 3. Reclassify member_field_drift (issue 3) from auto_repairable to
-- manual_review_required. Detection stays - a platform admin still sees
-- this count for observability - but nothing in this framework will ever
-- again treat profiles as authoritative for identity fields and repair
-- toward it. Every other issue type (1, 2, 4-15) is reproduced verbatim,
-- unchanged, from 20260726150000.
create or replace view member_domain_consistency_detail as
(
  select 'member_missing'::text as issue_type,
         'auto_repairable'::text as severity,
         p.id as profile_id, null::uuid as member_id, null::uuid as membership_id,
         format('profiles.id=%s has no matching members row', p.id) as detail
  from profiles p
  where not exists (select 1 from members m where m.id = p.id)
)
union all
(
  select 'member_orphaned', 'manual_review_required',
         null, m.id, null,
         format('members.id=%s has no matching profiles row', m.id)
  from members m
  where not exists (select 1 from profiles p where p.id = m.id)
)
union all
(
  -- M1.5.4: reclassified manual_review_required. profiles is frozen for
  -- identity since M1.5.3 - members is the identity Source of Truth, and
  -- a divergence here indicates a bug in the Member Portal's own write,
  -- not a synchronization gap; repairing toward profiles is now always
  -- wrong (Finding 2). Detection retained for observability only.
  select 'member_field_drift', 'manual_review_required',
         p.id, m.id, null,
         'members identity fields no longer match the current profiles values'
  from profiles p
  join members m on m.id = p.id
  where m.email is distinct from p.email
     or m.full_name is distinct from p.full_name
     or m.avatar_url is distinct from p.avatar_url
     or m.gender is distinct from p.gender
     or m.first_name is distinct from p.first_name
     or m.last_name is distinct from p.last_name
     or m.birth_date is distinct from p.birth_date
     or m.weight_unit is distinct from p.weight_unit
     or m.language is distinct from p.language
)
union all
(
  select 'member_duplicate_email', 'manual_review_required',
         p.id, null, null,
         format('profiles.email=%s is shared by more than one profile; members.email is UNIQUE and cannot mirror both', p.email)
  from profiles p
  where p.email <> ''
    and exists (select 1 from profiles p2 where p2.id <> p.id and lower(p2.email) = lower(p.email))
)
union all
(
  select 'membership_missing_for_active_gym', 'auto_repairable',
         p.id, null, null,
         format('profiles.id=%s has gym_id=%s but no active membership row for that gym', p.id, p.gym_id)
  from profiles p
  where p.gym_id is not null
    and not exists (
      select 1 from memberships ms
      where ms.member_id = p.id and ms.gym_id = p.gym_id and ms.status = 'active'
    )
)
union all
(
  select 'membership_should_be_active_false', 'auto_repairable',
         p.id, null, ms.id,
         format('membership %s is active for gym_id=%s but profiles.gym_id is %s', ms.id, ms.gym_id, coalesce(p.gym_id::text, 'NULL'))
  from memberships ms
  join profiles p on p.id = ms.member_id
  where ms.status = 'active'
    and (p.gym_id is null or p.gym_id <> ms.gym_id)
)
union all
(
  select 'membership_field_drift', 'auto_repairable',
         p.id, null, ms.id,
         format('active membership %s waiver fields no longer match the current profiles values', ms.id)
  from memberships ms
  join profiles p on p.id = ms.member_id
  where ms.status = 'active'
    and p.gym_id = ms.gym_id
    and (ms.waiver_accepted is distinct from p.waiver_accepted
      or ms.waiver_accepted_at is distinct from p.waiver_accepted_at)
)
union all
(
  select 'membership_orphaned', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s references member_id=%s which has no members row', ms.id, ms.member_id)
  from memberships ms
  where not exists (select 1 from members m where m.id = ms.member_id)
)
union all
(
  select 'membership_duplicate_active', 'auto_repairable',
         null, ranked.member_id, ranked.id,
         format('membership %s is a duplicate active row for member_id=%s, gym_id=%s', ranked.id, ranked.member_id, ranked.gym_id)
  from (
    select ms.*, row_number() over (partition by ms.member_id, ms.gym_id order by ms.created_at, ms.id) as rn
    from memberships ms
    where ms.status = 'active'
  ) ranked
  where ranked.rn > 1
)
union all
(
  select 'membership_multi_gym_active', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('member_id=%s has more than one active membership across different gyms (this row: gym_id=%s)', ms.member_id, ms.gym_id)
  from memberships ms
  where ms.status = 'active'
    and exists (
      select 1 from memberships ms2
      where ms2.member_id = ms.member_id and ms2.status = 'active' and ms2.gym_id <> ms.gym_id
    )
)
union all
(
  select 'membership_invalid_status', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s has unexpected status %L', ms.id, ms.status)
  from memberships ms
  where ms.status not in ('active', 'removed', 'transferred')
)
union all
(
  select 'membership_null_gym_id', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s has a null gym_id', ms.id)
  from memberships ms
  where ms.gym_id is null
)
union all
(
  select 'membership_predates_member', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s created_at (%s) predates its member''s created_at (%s)', ms.id, ms.created_at, m.created_at)
  from memberships ms
  join members m on m.id = ms.member_id
  where ms.created_at < m.created_at
)
union all
(
  select 'membership_invalid_gym_reference', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s references gym_id=%s which does not exist', ms.id, ms.gym_id)
  from memberships ms
  where not exists (select 1 from gyms g where g.id = ms.gym_id)
)
union all
(
  select 'member_invalid_auth_reference', 'manual_review_required',
         m.id, m.id, null,
         format('members.id=%s has no matching auth.users row', m.id)
  from members m
  where not exists (select 1 from auth.users u where u.id = m.id)
);

-- 4. reconcile_member_domain(): remove the member_field_drift auto-repair
-- branch entirely (Finding 2's manual-invocation path). With issue 3 now
-- classified manual_review_required in the view above, it is picked up
-- automatically by the existing generic "report every manual_review_required
-- issue, never act on it" tail at the end of this function - no repair
-- branch needs to remain for it. Every other branch (1, 5, 6, 7, 9, and the
-- manual_review_required tail) is reproduced verbatim, unchanged, from
-- 20260726150000.
create or replace function reconcile_member_domain(p_dry_run boolean default true)
returns table(issue_type text, action text, row_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_profile profiles%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  -- 1. member_missing
  select count(*) into v_count from profiles p where not exists (select 1 from members m where m.id = p.id);
  if v_count > 0 then
    if not p_dry_run then
      for v_profile in select * from profiles p where not exists (select 1 from members m where m.id = p.id) loop
        perform sync_member_from_profile(v_profile);
      end loop;
    end if;
    return query select 'member_missing'::text, (case when p_dry_run then 'would_create' else 'created' end)::text, v_count;
  end if;

  -- 5. membership_missing_for_active_gym
  select count(*) into v_count
  from profiles p
  where p.gym_id is not null
    and not exists (select 1 from memberships ms where ms.member_id = p.id and ms.gym_id = p.gym_id and ms.status = 'active');
  if v_count > 0 then
    if not p_dry_run then
      insert into memberships (id, member_id, gym_id, status, created_at, waiver_accepted, waiver_accepted_at)
      select gen_random_uuid(), p.id, p.gym_id, 'active', now(), p.waiver_accepted, p.waiver_accepted_at
      from profiles p
      where p.gym_id is not null
        and not exists (select 1 from memberships ms where ms.member_id = p.id and ms.gym_id = p.gym_id and ms.status = 'active');
    end if;
    return query select 'membership_missing_for_active_gym'::text, (case when p_dry_run then 'would_create' else 'created' end)::text, v_count;
  end if;

  -- 6. membership_should_be_active_false
  select count(*) into v_count
  from memberships ms join profiles p on p.id = ms.member_id
  where ms.status = 'active' and (p.gym_id is null or p.gym_id <> ms.gym_id);
  if v_count > 0 then
    if not p_dry_run then
      update memberships ms set status = 'removed'
      from profiles p
      where p.id = ms.member_id and ms.status = 'active' and (p.gym_id is null or p.gym_id <> ms.gym_id);
    end if;
    return query select 'membership_should_be_active_false'::text, (case when p_dry_run then 'would_end' else 'ended' end)::text, v_count;
  end if;

  -- 7. membership_field_drift
  select count(*) into v_count
  from memberships ms join profiles p on p.id = ms.member_id
  where ms.status = 'active' and p.gym_id = ms.gym_id
    and (ms.waiver_accepted is distinct from p.waiver_accepted or ms.waiver_accepted_at is distinct from p.waiver_accepted_at);
  if v_count > 0 then
    if not p_dry_run then
      update memberships ms set waiver_accepted = p.waiver_accepted, waiver_accepted_at = p.waiver_accepted_at
      from profiles p
      where p.id = ms.member_id and ms.status = 'active' and p.gym_id = ms.gym_id
        and (ms.waiver_accepted is distinct from p.waiver_accepted or ms.waiver_accepted_at is distinct from p.waiver_accepted_at);
    end if;
    return query select 'membership_field_drift'::text, (case when p_dry_run then 'would_refresh' else 'refreshed' end)::text, v_count;
  end if;

  -- 9. membership_duplicate_active
  select count(*) into v_count
  from (
    select row_number() over (partition by ms.member_id, ms.gym_id order by ms.created_at, ms.id) as rn
    from memberships ms where ms.status = 'active'
  ) ranked
  where ranked.rn > 1;
  if v_count > 0 then
    if not p_dry_run then
      delete from memberships ms
      using (
        select ms2.id, row_number() over (partition by ms2.member_id, ms2.gym_id order by ms2.created_at, ms2.id) as rn
        from memberships ms2 where ms2.status = 'active'
      ) ranked
      where ranked.id = ms.id and ranked.rn > 1;
    end if;
    return query select 'membership_duplicate_active'::text, (case when p_dry_run then 'would_delete_duplicates' else 'deleted_duplicates' end)::text, v_count;
  end if;

  -- Every manual_review_required issue type is reported, never acted on -
  -- member_field_drift now falls through to here, alongside every issue
  -- type that was always manual_review_required.
  return query
    select d.issue_type, 'manual_review_required'::text, count(*)::integer
    from member_domain_consistency_detail d
    where d.severity = 'manual_review_required'
    group by d.issue_type;

  return;
end;
$$;
