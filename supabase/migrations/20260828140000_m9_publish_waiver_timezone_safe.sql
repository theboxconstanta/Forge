-- M9_PUBLISH_WAIVER TIMEZONE FOLLOW-UP (disclosed in
-- FORGE_MASTER_HANDOFF_2026-08-28 §16 / §23, P0-03 reports). Narrow,
-- single-function fix. Does NOT reopen any closed item, does NOT touch
-- dashboard_resolve_window / the P0-01 trigger / any Financial RPC, and does
-- NOT redefine waiver / legal-acceptance semantics.
--
-- DEFECT
-- ------
-- `m9_publish_waiver()` computes the new waiver version's persisted
-- `gym_waivers.effective_date` as:
--
--     v_effective_date := greatest(current_date, coalesce(v_max_effective + 1, current_date));
--
-- and also returns `immediate := (v_effective_date <= current_date)`.
--
-- `current_date` is resolved in the DB SESSION timezone, which is UTC in
-- production (confirmed live: current_setting('TimeZone') = 'UTC'). The gym is
-- physically in Romania (UTC+2 EET / UTC+3 EEST). For the ~2-3 hours after
-- gym-local midnight, UTC's calendar date is still the previous day, so a
-- waiver published in that window gets an `effective_date` ONE DAY EARLIER
-- than the actual gym-local publish day - a wrong, retroactive-by-one-day
-- legal effective date persisted into an immutable `gym_waivers` row. The
-- value also varied with the caller's session timezone (reproduced live: the
-- same publish under a UTC session vs a session one calendar day behind
-- persisted different `effective_date` values).
--
-- This only changes the outcome when `current_date` is the winning operand of
-- `greatest()` (no prior waiver, or the latest prior waiver is already >=1 day
-- in the past). When a prior waiver is effective today or in the future, the
-- `v_max_effective + 1` branch dominates and the bug is inert.
--
-- FIX
-- ---
-- Derive the gym's business "today" explicitly in the gym timezone:
--
--     v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
--
-- `now() AT TIME ZONE 'Europe/Bucharest'` is `timestamp without time zone`
-- (gym-local wall clock); `::date` yields the gym-local calendar date. The
-- IANA zone applies the correct EET/EEST offset for the actual date - no
-- fixed offset is hard-coded. `v_today` replaces all three `current_date`
-- references. The business rule is unchanged: still
--     effective_date = greatest(business_today, coalesce(prev_max + 1, business_today))
-- (a max(), same operands, same chronological-ordering intent), and
--     immediate = (effective_date <= business_today)
-- (same `<=` inclusivity). Only the definition of "today" is corrected from
-- the DB session date to the gym-local date.
--
-- 'Europe/Bucharest' is an explicit single-gym (Romania) deployment constant,
-- consistent with 20260828120000 (P0-01 trigger) and 20260828130000
-- (dashboard_resolve_window). There is no gyms.timezone column and none is
-- introduced; this is NOT a generic multi-timezone guarantee.
--
-- SCOPE: exactly one function changes (CREATE OR REPLACE, same signature,
-- same RETURNS TABLE shape). SECURITY DEFINER, SET search_path TO 'public',
-- LANGUAGE plpgsql, owner postgres, the title/content validation, the version
-- count, the INSERT column list, the m9_write_audit_entry call, and the
-- RETURN QUERY shape are all unchanged. No schema/type change, no trigger, no
-- data change, no caller change (admin-manage-waiver passes no date), no
-- RLS/grant change. m9_write_audit_entry is NOT touched.

CREATE OR REPLACE FUNCTION public.m9_publish_waiver(
    p_gym_id uuid,
    p_actor_admin_id uuid,
    p_title text,
    p_content_ref text
)
RETURNS TABLE(id uuid, version text, effective_date date, immediate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_version int;
  v_max_effective date;
  v_effective_date date;
  v_new_id uuid;
  -- Gym business "today" (Europe/Bucharest), not the DB session date (UTC in
  -- production). Single-gym Romania deployment constant; IANA zone handles
  -- EET/EEST automatically. Replaces the former `current_date` usage so the
  -- persisted waiver effective_date is the real gym-local publish day.
  v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
begin
  if trim(p_title) = '' then
    raise exception 'invalid_title';
  end if;
  if trim(p_content_ref) = '' then
    raise exception 'invalid_content';
  end if;

  select count(*) + 1 into v_version from gym_waivers where gym_id = p_gym_id;
  select max(gym_waivers.effective_date) into v_max_effective from gym_waivers where gym_id = p_gym_id;
  v_effective_date := greatest(v_today, coalesce(v_max_effective + 1, v_today));

  insert into gym_waivers (gym_id, version, title, content_ref, effective_date, created_by)
  values (p_gym_id, v_version::text, trim(p_title), p_content_ref, v_effective_date, p_actor_admin_id)
  returning gym_waivers.id into v_new_id;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, null, 'gym_waiver_published');

  return query select v_new_id, v_version::text, v_effective_date, (v_effective_date <= v_today);
end;
$function$;

COMMENT ON FUNCTION public.m9_publish_waiver(uuid, uuid, text, text) IS 'M9 Waiver / Gym Rules Management - publishes a new immutable gym_waivers version. effective_date = greatest(gym-local today, previous_max_effective + 1); the gym business date is Europe/Bucharest (single-gym Romania deployment constant, no gyms.timezone column), not the DB session date - timezone-safety fix 20260828140000. Business rule, operands, and immediate (<=) semantics unchanged.';
