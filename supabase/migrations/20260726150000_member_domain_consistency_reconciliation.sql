-- M1.4.1b - Member Domain Consistency & Reconciliation
--
-- Objective: not to make Member Domain operational, but to make it
-- provable. profiles remains the sole Source of Truth. This migration
-- adds no cron job, no background job, and does not change what any
-- existing consumer reads or writes - it only adds the ability to ask
-- "is members/memberships currently a correct mirror of profiles?" and,
-- where the answer is unambiguously "no", to fix it deterministically.
--
-- Everything here is additive: one internal view, three
-- SECURITY DEFINER functions, all gated by is_platform_admin() -
-- the same authorization pattern already used by set_gym_paid_until()
-- and list_all_gyms_platform() for platform-wide, cross-Gym operations.

-- ---------------------------------------------------------------------
-- Detection model
-- ---------------------------------------------------------------------
-- One row per detected inconsistency. Not granted to anon/authenticated
-- directly - reached only through member_domain_consistency_report()/
-- _summary(), which enforce the authorization check. Fifteen distinct
-- issue types, each independently reasoned about below; several are
-- included for completeness even though a database constraint should
-- already make them impossible (defense in depth, not redundancy - a
-- constraint being dropped or bypassed is exactly the kind of thing a
-- consistency framework should still be able to notice).
create or replace view member_domain_consistency_detail as
(
  -- 1. A profiles row exists with no matching members row at all.
  select 'member_missing'::text as issue_type,
         'auto_repairable'::text as severity,
         p.id as profile_id, null::uuid as member_id, null::uuid as membership_id,
         format('profiles.id=%s has no matching members row', p.id) as detail
  from profiles p
  where not exists (select 1 from members m where m.id = p.id)
)
union all
(
  -- 2. A members row exists with no matching profiles row. Should be
  -- structurally near-impossible (both cascade from auth.users), but
  -- not enforced directly between the two tables - checked directly.
  select 'member_orphaned', 'manual_review_required',
         null, m.id, null,
         format('members.id=%s has no matching profiles row', m.id)
  from members m
  where not exists (select 1 from profiles p where p.id = m.id)
)
union all
(
  -- 3. A members row exists but no longer matches the identity fields
  -- currently in profiles - the known, documented consequence of
  -- M1.4.1 only syncing at creation time, not on later profile edits.
  select 'member_field_drift', 'auto_repairable',
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
  -- 4. Two or more profiles share an email. profiles itself has no
  -- uniqueness constraint on email, but members does - this is a
  -- latent risk that will eventually and permanently block sync for
  -- whichever profile loses the race, not merely a cosmetic issue.
  select 'member_duplicate_email', 'manual_review_required',
         p.id, null, null,
         format('profiles.email=%s is shared by more than one profile; members.email is UNIQUE and cannot mirror both', p.email)
  from profiles p
  where p.email <> ''
    and exists (select 1 from profiles p2 where p2.id <> p.id and lower(p2.email) = lower(p.email))
)
union all
(
  -- 5. profiles.gym_id is set, but no active membership reflects it.
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
  -- 6. An active membership exists for a member/gym pair profiles no
  -- longer reflects - covers both "removed but membership still
  -- active" and "gym mismatch" (a mismatch necessarily produces both
  -- this row and a #5 row for the correct gym, which is the correct,
  -- non-redundant decomposition rather than a separate mismatch type).
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
  -- 7. An active membership's waiver fields no longer match profiles -
  -- the Membership-owned equivalent of #3.
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
  -- 8. A membership references a member_id with no members row.
  -- Should be FK-enforced and therefore impossible; checked directly.
  select 'membership_orphaned', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s references member_id=%s which has no members row', ms.id, ms.member_id)
  from memberships ms
  where not exists (select 1 from members m where m.id = ms.member_id)
)
union all
(
  -- 9. Two or more active membership rows for the exact same
  -- member_id + gym_id pair - a true duplicate, only possible from a
  -- race or a bug, never a real business event. The earliest-created
  -- row (by created_at, then id as a tiebreaker - uuid has no natural
  -- ordering for MIN/MAX) is treated as the real one.
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
  -- 10. One member with active memberships at two or more DIFFERENT
  -- gyms simultaneously. Not repairable deterministically: profiles
  -- can only hold one gym_id, so this contradicts what the Source of
  -- Truth can even represent, and choosing which is "correct" is a
  -- human judgment call, not a data-mechanical one.
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
  -- 11. Defensive: a status value outside the CHECK constraint's
  -- allowed set. Should be impossible unless the constraint itself was
  -- dropped or bypassed.
  select 'membership_invalid_status', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s has unexpected status %L', ms.id, ms.status)
  from memberships ms
  where ms.status not in ('active', 'removed', 'transferred')
)
union all
(
  -- 12. Defensive: an active membership with no gym_id. Should be
  -- impossible given the NOT NULL constraint.
  select 'membership_null_gym_id', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s has a null gym_id', ms.id)
  from memberships ms
  where ms.gym_id is null
)
union all
(
  -- 13. A membership's created_at predates its own member's
  -- created_at - the member cannot have joined a Gym before existing.
  select 'membership_predates_member', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s created_at (%s) predates its member''s created_at (%s)', ms.id, ms.created_at, m.created_at)
  from memberships ms
  join members m on m.id = ms.member_id
  where ms.created_at < m.created_at
)
union all
(
  -- 14. Defensive: a membership referencing a Gym that does not exist.
  -- Should be FK-enforced and therefore impossible.
  select 'membership_invalid_gym_reference', 'manual_review_required',
         null, ms.member_id, ms.id,
         format('membership %s references gym_id=%s which does not exist', ms.id, ms.gym_id)
  from memberships ms
  where not exists (select 1 from gyms g where g.id = ms.gym_id)
)
union all
(
  -- 15. Defensive: a members row referencing an auth.users id that no
  -- longer exists. Should be FK-enforced and therefore impossible.
  select 'member_invalid_auth_reference', 'manual_review_required',
         m.id, m.id, null,
         format('members.id=%s has no matching auth.users row', m.id)
  from members m
  where not exists (select 1 from auth.users u where u.id = m.id)
);

-- ---------------------------------------------------------------------
-- Verification surface (Question 1: prove synchronization)
-- ---------------------------------------------------------------------
-- Empty result = proven consistent. Every row = a specific, named,
-- reasoned-about inconsistency, not a vague "something is wrong".
create or replace function member_domain_consistency_report()
returns table(issue_type text, severity text, profile_id uuid, member_id uuid, membership_id uuid, detail text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return query select * from member_domain_consistency_detail;
end;
$$;

grant execute on function member_domain_consistency_report() to authenticated;

-- Aggregated counts per issue type - a fast health check without
-- pulling every offending row.
create or replace function member_domain_consistency_summary()
returns table(issue_type text, severity text, issue_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select d.issue_type, d.severity, count(*)
    from member_domain_consistency_detail d
    group by d.issue_type, d.severity
    order by d.issue_type;
end;
$$;

grant execute on function member_domain_consistency_summary() to authenticated;

-- ---------------------------------------------------------------------
-- Reconciliation model (Question 3/4: repair strategy)
-- ---------------------------------------------------------------------
-- Repairs only the five auto_repairable issue types (1, 3, 5, 6, 7, 9
-- above), each because profiles is unambiguously the Source of Truth
-- for what the correct state should be. Every manual_review_required
-- issue type is reported, never touched. p_dry_run defaults to true -
-- calling this with no arguments only reports what would happen, per
-- the same safety discipline already used for supabase migration
-- repair's own --dry-run flag. Not scheduled anywhere - no cron, no
-- background job; this is invoked explicitly, by a platform admin,
-- when they choose to.
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

  -- 3. member_field_drift
  select count(*) into v_count
  from profiles p join members m on m.id = p.id
  where m.email is distinct from p.email or m.full_name is distinct from p.full_name
     or m.avatar_url is distinct from p.avatar_url or m.gender is distinct from p.gender
     or m.first_name is distinct from p.first_name or m.last_name is distinct from p.last_name
     or m.birth_date is distinct from p.birth_date or m.weight_unit is distinct from p.weight_unit
     or m.language is distinct from p.language;
  if v_count > 0 then
    if not p_dry_run then
      update members m set
        email = p.email, full_name = p.full_name, avatar_url = p.avatar_url, gender = p.gender,
        first_name = p.first_name, last_name = p.last_name, birth_date = p.birth_date,
        weight_unit = p.weight_unit, language = p.language
      from profiles p
      where p.id = m.id
        and (m.email is distinct from p.email or m.full_name is distinct from p.full_name
          or m.avatar_url is distinct from p.avatar_url or m.gender is distinct from p.gender
          or m.first_name is distinct from p.first_name or m.last_name is distinct from p.last_name
          or m.birth_date is distinct from p.birth_date or m.weight_unit is distinct from p.weight_unit
          or m.language is distinct from p.language);
    end if;
    return query select 'member_field_drift'::text, (case when p_dry_run then 'would_refresh' else 'refreshed' end)::text, v_count;
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

  -- Every manual_review_required issue type is reported, never acted on.
  return query
    select d.issue_type, 'manual_review_required'::text, count(*)::integer
    from member_domain_consistency_detail d
    where d.severity = 'manual_review_required'
    group by d.issue_type;

  return;
end;
$$;

grant execute on function reconcile_member_domain(boolean) to authenticated;
