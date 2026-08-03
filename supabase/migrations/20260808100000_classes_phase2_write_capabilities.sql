-- Classes Phase 2 (Forge Admin Web) - the first write capabilities for the
-- Classes Domain beyond create/delete: editing a class in place (coach,
-- capacity, date, time), and a proper cancel path.
--
-- Two real gaps found while implementing this, both addressed with the
-- minimum SQL required - no schema redesign, no new tables:
--
-- 1. `classes` has never had an UPDATE policy (CLASSES_DOMAIN_ASSESSMENT.md
--    Section 6; confirmed again here: the existing PWA's own Admin screen
--    never once calls `.update()` on `classes`, only `.insert()`/`.delete()`
--    - App.jsx's saveClasa/stergeClasa/stergeSeria). Editing a class was
--    never possible before, from either client. Added below, mirroring the
--    existing `wods_admin_update` policy's own shape exactly
--    (is_coach_or_admin(gym_id), both USING and WITH CHECK).
--
-- 2. Nothing has ever stopped `max_spots` from being set below the number
--    of members already booked - enforce_class_capacity (20260714, this
--    migration's sibling) only guards new bookings, because no UPDATE path
--    on `classes` existed for it to matter until now. Guarded with a new,
--    narrow BEFORE UPDATE trigger, mirroring enforce_class_capacity's own
--    SECURITY DEFINER rationale.
--
-- Also added: cancel_class(), a SECURITY DEFINER RPC that is the canonical,
-- transactional version of App.jsx's own stergeClasa - it refunds one
-- session credit to every member with a future booking on a limited-
-- sessions plan, then deletes the class row, exactly like stergeClasa does,
-- but as a single atomic server-side operation instead of several
-- unguarded client round-trips.
--
-- Found, NOT fixed, while building this (out of scope - see below): the
-- refund step only ever actually works for an Admin caller, in both the
-- old client-side path AND this new RPC, for two different reasons that
-- happen to produce the same end result. Client-side, a Coach's UPDATE on
-- subscriptions is silently dropped by subscriptions_update_own_or_
-- waitlist_or_admin's own RLS (is_admin() only, no is_coach_or_admin()
-- variant - member_email won't be the coach's own, and there's no
-- just-booked-by-this-member row to satisfy the waitlist clause either) -
-- 0 rows affected, no error, no refund, nothing visibly wrong. Naively
-- making this RPC SECURITY DEFINER would have bypassed that same RLS and
-- reached the row - only to hit subscriptions_restrict_member_update_trg
-- (20260701080000), a BEFORE UPDATE trigger that always fires regardless
-- of SECURITY DEFINER and calls is_admin() (the original 0-argument
-- version) itself: for a Coach it would raise 'sessions_used may only be
-- incremented by 1 via the waitlist auto-book path' outright, aborting the
-- whole function - a hard failure where today there's only a silent
-- no-op. So the refund loop below is deliberately gated on is_admin(),
-- matching today's real behavior exactly rather than "fixing" it: a
-- Coach's Cancel still deletes the class successfully, still doesn't
-- refund anyone, exactly as it doesn't today. Actually closing this gap
-- would mean changing subscriptions_restrict_member_update_trg's own
-- authorization shape, which governs the wider Member Domain
-- (MEMBER_DOMAIN_ARCHITECTURE.md, FROZEN/canonical) - out of scope for a
-- Classes-module milestone. Left as a named, disclosed remaining risk.

-- ============================================================
-- 1. classes_admin_update
-- ============================================================
drop policy if exists "classes_admin_update" on classes;
create policy "classes_admin_update" on classes for update to authenticated
  using (is_coach_or_admin(gym_id))
  with check (is_coach_or_admin(gym_id));

-- ============================================================
-- 2. Capacity floor on update (mirrors enforce_class_capacity's own
--    SECURITY DEFINER rationale: a plain SELECT count(*) FROM bookings
--    here would already be readable under the caller's own RLS since
--    bookings_select_all is unconditional for any gym member, but keeping
--    this SECURITY DEFINER matches the established convention for
--    capacity-guarding functions in this file's sibling migration and
--    avoids any dependency on the caller's own read access.)
-- ============================================================
create or replace function enforce_class_capacity_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if new.max_spots is not null and new.max_spots is distinct from old.max_spots then
    select count(*) into v_count from bookings where class_id = old.id::text;
    if new.max_spots < v_count then
      raise exception 'cannot set capacity to % - % member(s) already booked', new.max_spots, v_count;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists classes_enforce_capacity_on_update_trg on classes;
create trigger classes_enforce_capacity_on_update_trg
  before update on classes
  for each row execute function enforce_class_capacity_on_update();

-- ============================================================
-- 3. cancel_class(p_class_id) - refund future bookings' session credits,
--    then delete the class. Ports App.jsx's stergeClasa algorithm exactly:
--    only refunds when the class hasn't already passed (date >=
--    current_date), one credit per member with a booking, matched to that
--    member's most recent active, limited-sessions subscription by email
--    (subscriptions has no member_id column - see
--    FINANCIAL_DOMAIN_ARCHITECTURE.md / PROJECT_STATE.md). bookings rows
--    for the cancelled class are intentionally left in place (not
--    deleted) - matches stergeClasa's own existing behavior, and
--    bookings.class_id already has no FK to classes.id
--    (CLASSES_DOMAIN_ASSESSMENT.md Section 10, deliberately unfixed), so
--    this is not a new orphaning risk, only the same pre-existing one.
--    class_waitlist rows for the class ARE cleaned up automatically (its
--    own class_id FK is ON DELETE CASCADE).
-- ============================================================
create or replace function cancel_class(p_class_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_date date;
  v_refunded int := 0;
  r record;
begin
  select gym_id, date into v_gym_id, v_date from classes where id = p_class_id for update;
  if not found then
    raise exception 'class % does not exist', p_class_id;
  end if;
  if not is_coach_or_admin(v_gym_id) then
    raise exception 'not authorized to cancel this class';
  end if;

  -- See this migration's own header comment: gated on is_admin(), not
  -- is_coach_or_admin(), deliberately - matches the existing (pre-this-
  -- migration) production behavior exactly, where only an Admin caller's
  -- refund actually lands.
  if is_admin(v_gym_id) and v_date >= current_date then
    for r in
      select p.email
      from bookings b
      join profiles p on p.id = b.member_id
      where b.class_id = p_class_id::text
        and p.email is not null
    loop
      update subscriptions s
      set sessions_used = greatest(0, s.sessions_used - 1)
      where s.id = (
        select id from subscriptions
        where lower(member_email) = lower(r.email)
          and is_active = true
          and sessions_total is not null
        order by created_at desc
        limit 1
      );
      if found then
        v_refunded := v_refunded + 1;
      end if;
    end loop;
  end if;

  delete from classes where id = p_class_id;
  return v_refunded;
end;
$$;

revoke all on function cancel_class(uuid) from public;
grant execute on function cancel_class(uuid) to authenticated;
