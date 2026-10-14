-- FORGE - Class Editing & Recurring Series Management.
--
-- Architecture discovered (verified live, read-only, 2026-10-08):
--   * A recurring series has NEVER had a stored identity. The PWA's
--     saveClasa (App.jsx) - and forge-admin-web's createRecurringClasses -
--     pre-generate one `classes` row per occurrence (up to 52 weeks ahead)
--     and insert the whole set in ONE INSERT statement. There is no
--     recurrence rule, no parent row, no generator that runs again later,
--     and no exception/override mechanism.
--   * "Delete series" (stergeSeria) and forge-admin-web's scope editor
--     identify a series heuristically by name + start_time + end_time +
--     coach. That is NOT a safe identity for editing: two unrelated
--     schedules can share all four.
--   * Every row inserted by one INSERT statement shares the exact same
--     `created_at` (now() is the transaction timestamp). Live data: all
--     1037 classes fall into exactly 10 (gym_id, created_at) batches, each
--     with one uniform name/time/coach/capacity/color set, zero single-row
--     batches, zero duplicate (gym, date, name, start_time) slots. Batch
--     provenance is therefore an exact, non-heuristic series identity for
--     every existing row, and it is what the backfill below uses.
--
-- This migration (additive only - no row is deleted, no booking touched):
--   1. classes.series_id uuid NULL - the stable series identifier. NULL =
--      a one-off class (only "This class only" editing applies).
--   2. classes.series_exception boolean NOT NULL DEFAULT false - set when
--      one occurrence of a series is edited on its own (from either
--      client). Series-wide edits skip exception rows, so an individually
--      customized occurrence is never silently overwritten.
--   3. A partial index for series lookups.
--   4. Backfill series_id from insert-batch provenance (only rows still
--      NULL, only batches of more than one row - re-running is a no-op).
--   5. classes_series_guard_trg - series_id is immutable on UPDATE, and
--      series_exception is maintained by the database, never by a client.
--   6. edit_class_scope(...) - the single, transactional write path for
--      "This class only" / "This and future classes" / "Entire series",
--      with a dry-run mode used for the confirmation summary.
--
-- Unchanged: RLS policies (classes_admin_update still governs every
-- write - edit_class_scope is SECURITY INVOKER), the capacity trigger
-- classes_enforce_capacity_on_update_trg (still the final authority on
-- capacity), the P0-01 deletion trigger, bookings, subscriptions.

-- ============================================================
-- 1-2. Columns
-- ============================================================
alter table public.classes add column if not exists series_id uuid;
alter table public.classes add column if not exists series_exception boolean not null default false;

comment on column public.classes.series_id is
  'Recurring-series identity. All occurrences created together by one recurring create share it; NULL = one-off class. Immutable after insert (classes_series_guard_trg).';
comment on column public.classes.series_exception is
  'true once this occurrence was edited individually (or moved). Maintained only by classes_series_guard_trg; edit_class_scope future/series edits skip these rows.';

-- ============================================================
-- 3. Index - series lookups are always (gym_id, series_id[, date])
-- ============================================================
create index if not exists classes_gym_series_date_idx
  on public.classes (gym_id, series_id, date)
  where series_id is not null;

-- ============================================================
-- 4. Backfill from insert-batch provenance. Runs BEFORE the guard
--    trigger exists (the guard forbids changing series_id on UPDATE).
--    The capacity trigger is a no-op here (max_spots unchanged).
-- ============================================================
with batches as (
  select gym_id, created_at, gen_random_uuid() as sid
  from public.classes
  where series_id is null and created_at is not null
  group by gym_id, created_at
  having count(*) > 1
)
update public.classes c
set series_id = b.sid
from batches b
where c.series_id is null
  and c.gym_id = b.gym_id
  and c.created_at = b.created_at;

-- ============================================================
-- 5. Guard trigger
-- ============================================================
create or replace function public.classes_series_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.series_id is distinct from old.series_id then
    raise exception using errcode = 'P0001', message = 'series_id_immutable';
  end if;

  -- edit_class_scope sets this (transaction-local) only around its own
  -- multi-occurrence UPDATE: a series-wide change is not an exception,
  -- and an existing exception flag is kept exactly as it was.
  if coalesce(current_setting('forge.class_series_edit', true), '') = 'on' then
    new.series_exception := old.series_exception;
    return new;
  end if;

  -- Any other UPDATE (single-occurrence edit from the PWA, forge-admin-
  -- web's updateClass/updateClassScope, ...) on a series row that changes
  -- what the occurrence looks like marks it as customized. A client can
  -- never set or clear the flag directly.
  new.series_exception := old.series_exception or (
    old.series_id is not null and (
      new.name, new.date, new.start_time, new.end_time, new.coach, new.max_spots, new.color
    ) is distinct from (
      old.name, old.date, old.start_time, old.end_time, old.coach, old.max_spots, old.color
    )
  );
  return new;
end;
$$;

drop trigger if exists classes_series_guard_trg on public.classes;
create trigger classes_series_guard_trg
  before update on public.classes
  for each row execute function public.classes_series_guard();

-- ============================================================
-- 6. edit_class_scope
--
--   p_class_id  the occurrence the admin opened (the anchor)
--   p_scope     'this' | 'future' | 'series'
--   p_expected  the anchor's field values as the client loaded them
--               (name, start_time, end_time, coach, max_spots, color) -
--               optimistic concurrency: if another session changed the
--               anchor meanwhile, nothing is written
--               ('class_changed_concurrently'). Required unless dry run.
--   p_changes   ONLY the fields the admin changed (subset of name,
--               start_time, end_time, coach, max_spots, color). Unchanged
--               fields are never written to any row.
--   p_dry_run   validate + count, write nothing (confirmation summary).
--
-- Affected set:
--   this   -> the anchor only (past classes allowed: a correction such as
--             the wrong coach; bookings/attendance live in `bookings` and
--             are never touched).
--   future -> anchor + same-series, not-yet-ended, non-exception
--             occurrences dated on/after the anchor.
--   series -> anchor + every same-series, not-yet-ended, non-exception
--             occurrence. Ended occurrences are history and are never
--             rewritten, whatever the scope.
--   "Ended" = (date + end_time) in Europe/Bucharest <= now() - the same
--   boundary as P0-01's enforce_class_deletion_policy.
--
-- Validation (all-or-nothing; the whole call is one transaction):
--   end_time > start_time for every affected row; max_spots null or >= 1
--   and >= that row's own booking count (bookings has no status column -
--   every row is an active reservation); no affected row may land on an
--   existing (gym, date, name, start_time) slot of another class.
-- ============================================================
create or replace function public.edit_class_scope(
  p_class_id uuid,
  p_scope text,
  p_expected jsonb,
  p_changes jsonb,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_anchor public.classes%rowtype;
  v_now_local timestamp := (now() at time zone 'Europe/Bucharest');
  v_ids uuid[];
  v_has_name boolean;
  v_has_start boolean;
  v_has_end boolean;
  v_has_coach boolean;
  v_has_max boolean;
  v_has_color boolean;
  v_name text;
  v_start time;
  v_end time;
  v_coach text;
  v_max int;
  v_color text;
  v_bad jsonb;
  v_targets jsonb;
  v_skipped int := 0;
  v_past int := 0;
  v_count int;
  v_first date;
  v_last date;
  v_booked_total int;
  v_booked_max int;
begin
  if p_scope is null or p_scope not in ('this', 'future', 'series') then
    raise exception using errcode = 'P0001', message = 'invalid_scope';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_changes';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_changes) k
    where k not in ('name', 'start_time', 'end_time', 'coach', 'max_spots', 'color')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_changes';
  end if;
  if not exists (select 1 from jsonb_object_keys(p_changes)) then
    raise exception using errcode = 'P0001', message = 'no_changes';
  end if;

  v_has_name := p_changes ? 'name';
  v_has_start := p_changes ? 'start_time';
  v_has_end := p_changes ? 'end_time';
  v_has_coach := p_changes ? 'coach';
  v_has_max := p_changes ? 'max_spots';
  v_has_color := p_changes ? 'color';

  if v_has_name then
    v_name := nullif(btrim(p_changes->>'name'), '');
    if v_name is null then
      raise exception using errcode = 'P0001', message = 'invalid_name';
    end if;
  end if;
  if v_has_coach then
    v_coach := nullif(btrim(p_changes->>'coach'), '');
    if v_coach is null then
      raise exception using errcode = 'P0001', message = 'invalid_coach';
    end if;
  end if;
  begin
    if v_has_start then v_start := (p_changes->>'start_time')::time; end if;
    if v_has_end then v_end := (p_changes->>'end_time')::time; end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'invalid_time_range';
  end;
  if (v_has_start and v_start is null) or (v_has_end and v_end is null) then
    raise exception using errcode = 'P0001', message = 'invalid_time_range';
  end if;
  if v_has_max and jsonb_typeof(p_changes->'max_spots') <> 'null' then
    if jsonb_typeof(p_changes->'max_spots') <> 'number'
       or (p_changes->>'max_spots')::numeric <> trunc((p_changes->>'max_spots')::numeric)
       or (p_changes->>'max_spots')::numeric < 1 then
      raise exception using errcode = 'P0001', message = 'invalid_capacity';
    end if;
    v_max := (p_changes->>'max_spots')::int;
  end if;
  if v_has_color then
    v_color := p_changes->>'color';
    if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception using errcode = 'P0001', message = 'invalid_color';
    end if;
  end if;

  -- Anchor (RLS: classes_select_all already limits this to the caller's
  -- gym). Authorize before locking: FOR UPDATE only sees rows the caller
  -- may update, which would report a member's attempt as "not found".
  select * into v_anchor from public.classes where id = p_class_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'class_not_found';
  end if;
  if not is_coach_or_admin(v_anchor.gym_id) then
    raise exception using errcode = 'P0001', message = 'not_authorized';
  end if;
  if not p_dry_run then
    select * into v_anchor from public.classes where id = p_class_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'class_not_found';
    end if;
  end if;

  if not p_dry_run and p_expected is null then
    raise exception using errcode = 'P0001', message = 'missing_expected';
  end if;
  if p_expected is not null and (
       v_anchor.name is distinct from (p_expected->>'name')
    or v_anchor.start_time is distinct from (p_expected->>'start_time')::time
    or v_anchor.end_time is distinct from (p_expected->>'end_time')::time
    or v_anchor.coach is distinct from (p_expected->>'coach')
    or v_anchor.max_spots is distinct from (p_expected->>'max_spots')::int
    or v_anchor.color is distinct from (p_expected->>'color')
  ) then
    raise exception using errcode = 'P0001', message = 'class_changed_concurrently';
  end if;

  if p_scope = 'this' then
    v_ids := array[v_anchor.id];
  else
    if v_anchor.series_id is null then
      raise exception using errcode = 'P0001', message = 'not_a_series';
    end if;
    if (v_anchor.date + v_anchor.end_time) <= v_now_local then
      raise exception using errcode = 'P0001', message = 'series_scope_on_ended_class';
    end if;

    -- Lock in id order (deadlock-safe against a concurrent series edit).
    -- FOR UPDATE re-evaluates the WHERE on the latest row version, so an
    -- occurrence that became an exception while we waited is excluded.
    if p_dry_run then
      select array_agg(id order by date, start_time, id) into v_ids
      from public.classes
      where gym_id = v_anchor.gym_id and series_id = v_anchor.series_id
        and (id = v_anchor.id or (
              series_exception = false
          and (date + end_time) > v_now_local
          and (p_scope = 'series' or date >= v_anchor.date)));
    else
      select array_agg(s.id) into v_ids
      from (
        select id from public.classes
        where gym_id = v_anchor.gym_id and series_id = v_anchor.series_id
          and (id = v_anchor.id or (
                series_exception = false
            and (date + end_time) > v_now_local
            and (p_scope = 'series' or date >= v_anchor.date)))
        order by id
        for update
      ) s;
    end if;

    select
      count(*) filter (where series_exception and (date + end_time) > v_now_local),
      count(*) filter (where (date + end_time) <= v_now_local)
    into v_skipped, v_past
    from public.classes
    where gym_id = v_anchor.gym_id and series_id = v_anchor.series_id
      and id <> v_anchor.id
      and (p_scope = 'series' or date >= v_anchor.date);
  end if;

  -- Per-row validation on the merged (new) values, held as a jsonb
  -- recordset (no temp table: the invoker role needs no TEMP privilege).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'date', c.date,
      'new_name', case when v_has_name then v_name else c.name end,
      'new_start', case when v_has_start then v_start else c.start_time end,
      'new_end', case when v_has_end then v_end else c.end_time end,
      'booked', (select count(*) from public.bookings b where b.class_id = c.id::text)
    )), '[]'::jsonb)
  into v_targets
  from public.classes c
  where c.id = any(v_ids);

  select jsonb_agg(t.date order by t.date) into v_bad
  from jsonb_to_recordset(v_targets) as t(id uuid, date date, new_name text, new_start time, new_end time, booked int)
  where t.new_end <= t.new_start;
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'invalid_time_range', detail = v_bad::text;
  end if;

  if v_has_max and v_max is not null then
    select jsonb_agg(jsonb_build_object('date', t.date, 'booked', t.booked) order by t.date) into v_bad
    from jsonb_to_recordset(v_targets) as t(id uuid, date date, new_name text, new_start time, new_end time, booked int)
    where t.booked > v_max;
    if v_bad is not null then
      raise exception using errcode = 'P0001', message = 'capacity_below_bookings', detail = v_bad::text;
    end if;
  end if;

  if v_has_name or v_has_start then
    select jsonb_agg(t.date order by t.date) into v_bad
    from jsonb_to_recordset(v_targets) as t(id uuid, date date, new_name text, new_start time, new_end time, booked int)
    where exists (
      select 1 from public.classes o
      where o.gym_id = v_anchor.gym_id
        and o.id <> all(v_ids)
        and o.date = t.date
        and o.start_time = t.new_start
        and o.name = t.new_name
    );
    if v_bad is not null then
      raise exception using errcode = 'P0001', message = 'duplicate_class', detail = v_bad::text;
    end if;
  end if;

  select count(*), min(t.date), max(t.date), coalesce(sum(t.booked), 0), coalesce(max(t.booked), 0)
  into v_count, v_first, v_last, v_booked_total, v_booked_max
  from jsonb_to_recordset(v_targets) as t(id uuid, date date, new_name text, new_start time, new_end time, booked int);

  if not p_dry_run then
    if p_scope <> 'this' then
      perform set_config('forge.class_series_edit', 'on', true);
    end if;

    update public.classes c set
      name = case when v_has_name then v_name else c.name end,
      start_time = case when v_has_start then v_start else c.start_time end,
      end_time = case when v_has_end then v_end else c.end_time end,
      coach = case when v_has_coach then v_coach else c.coach end,
      max_spots = case when v_has_max then v_max else c.max_spots end,
      color = case when v_has_color then v_color else c.color end
    where c.id = any(v_ids);
    get diagnostics v_count = row_count;

    if p_scope <> 'this' then
      perform set_config('forge.class_series_edit', 'off', true);
    end if;
  end if;

  return jsonb_build_object(
    'scope', p_scope,
    'dry_run', p_dry_run,
    'affected', v_count,
    'first_date', v_first,
    'last_date', v_last,
    'booked_total', v_booked_total,
    'booked_max', v_booked_max,
    'skipped_exceptions', v_skipped,
    'preserved_past', v_past,
    'ids', to_jsonb(v_ids)
  );
end;
$$;

comment on function public.edit_class_scope(uuid, text, jsonb, jsonb, boolean) is
  'Class editing - single transactional write path for This class only / This and future classes / Entire series. SECURITY INVOKER: classes_admin_update RLS + is_coach_or_admin gate every write. Never rewrites ended occurrences or series exceptions on multi-occurrence scopes; never touches bookings. 20261008090000.';

revoke all on function public.edit_class_scope(uuid, text, jsonb, jsonb, boolean) from public;
revoke all on function public.edit_class_scope(uuid, text, jsonb, jsonb, boolean) from anon;
grant execute on function public.edit_class_scope(uuid, text, jsonb, jsonb, boolean) to authenticated;
