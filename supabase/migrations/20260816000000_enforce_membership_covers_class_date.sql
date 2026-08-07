-- P0 fix: MEMBERSHIP_BOOKING_ENFORCEMENT_AUDIT.md found that
-- enforce_subscription_sessions() (bookings_enforce_sessions_trg) - the
-- ONLY place in the entire stack, client or server, either repo, that
-- consults `subscriptions` state during booking creation - only ever
-- checked whether the member had an active subscription *today*
-- (`current_date`), and only to gate *session exhaustion* on that active
-- plan. Its own `IF NOT FOUND THEN RETURN NEW` branch meant "no active
-- subscription at all" was silently ALLOWED rather than rejected - so a
-- member could book a class dated well after their membership's own
-- end_date, as long as the membership was still active at the moment they
-- clicked "book". Confirmed live in production: 160 bookings across 27
-- non-admin members created with no subscription covering the class date,
-- 2 of which reached a real check-in.
--
-- Fix: validate against the CLASS'S OWN DATE (classes.date), not
-- current_date. A booking is only allowed if a subscription exists whose
-- [start_date, end_date] window covers the date of the class being
-- booked - "member had an active plan when they clicked book" is replaced
-- by "member has a plan that is valid on the day of the class itself",
-- exactly the rule MEMBERSHIP_COVERAGE_ENFORCEMENT_P0_REPORT.md's own
-- mission specifies. Sessions-exhaustion enforcement on the matched
-- subscription is unchanged.
--
-- Scope discipline: only this one trigger function changes. The
-- is_admin(new.gym_id) staff-override bypass (added by the multi-tenant
-- RLS rewrite, 20260714130000) is preserved unmodified, exactly as the
-- audit's own recommendation called for - adminAdaugaInClasa (PWA) and
-- addWalkIn (forge-admin-web's own Walk-In dialog, attendance/api.ts -
-- itself a bookings-insert path the original audit missed, see the P0
-- report's own §2 correction) both continue to let an admin add a member
-- regardless of membership state, unchanged. A coach is NOT covered by
-- is_admin() (checks the `admins` table only) and remains subject to this
-- check, same as before.
--
-- A defensive "class % does not exist" guard was added ahead of the
-- coverage check, mirroring enforce_class_capacity()'s own identical
-- guard - belt-and-suspenders only: that trigger already fires first
-- (alphabetically "capacity" < "sessions") and already raises on a
-- missing class, so this should never actually trigger in practice.
--
-- No retroactive change to existing bookings - this only gates new
-- INSERTs, exactly as the mission requires.

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
    raise exception 'membership does not cover the class date (%)', v_class_date;
  end if;

  if v_sessions_total is not null and coalesce(v_sessions_used, 0) >= v_sessions_total then
    raise exception 'member % has exhausted their sessions (% / %)', new.member_id, v_sessions_used, v_sessions_total;
  end if;

  return new;
end;
$function$;
