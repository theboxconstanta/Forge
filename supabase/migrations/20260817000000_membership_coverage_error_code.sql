-- P0 UX refinement (MEMBERSHIP_COVERAGE_DIALOG_P0_REPORT.md): no business
-- logic, condition, or business rule changes here at all - every branch,
-- every date comparison, every bypass is byte-identical to
-- 20260816000000_enforce_membership_covers_class_date.sql. The ONLY
-- change is attaching a distinct, stable SQLSTATE (USING ERRCODE) to the
-- membership-coverage rejection specifically, so both clients can detect
-- *this one* rejection reason (to show a dedicated explanatory dialog)
-- without brittle matching on the exception's own message text, which
-- could change wording later for unrelated reasons. This is exactly the
-- "introduce the minimal safe mechanism necessary" the mission's own
-- Error Mapping section calls for when no structured error already
-- exists - not a reinterpretation of what gets blocked or when.
--
-- 'FRG01' is an arbitrary, Forge-specific 5-character SQLSTATE, distinct
-- from Postgres's own reserved classes (P0001 raise_exception etc. stay
-- on every OTHER raise in this function and in enforce_class_capacity() -
-- capacity-full and sessions-exhausted rejections are deliberately left
-- exactly as they already were, so existing generic error handling for
-- those is completely unaffected).

CREATE OR REPLACE FUNCTION public.enforce_subscription_sessions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_class_date date;
  v_sessions_total int;
  v_sessions_used int;
begin
  if is_admin(new.gym_id) then
    return new;
  end if;

  select email into v_email from profiles where id = new.member_id;
  if v_email is null then
    return new;
  end if;

  select date into v_class_date from classes where id::text = new.class_id;
  if not found then
    raise exception 'class % does not exist', new.class_id;
  end if;

  select sessions_total, sessions_used into v_sessions_total, v_sessions_used
  from subscriptions
  where lower(member_email) = lower(v_email)
    and gym_id = new.gym_id
    and is_active = true and queued = false
    and start_date <= v_class_date and end_date >= v_class_date
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'membership does not cover the class date (%)', v_class_date
      using errcode = 'FRG01';
  end if;

  if v_sessions_total is not null and coalesce(v_sessions_used, 0) >= v_sessions_total then
    raise exception 'member % has exhausted their sessions (% / %)', new.member_id, v_sessions_used, v_sessions_total;
  end if;

  return new;
end;
$function$;
