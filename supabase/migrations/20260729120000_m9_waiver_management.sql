-- M9 Waiver / Gym Rules Management (self-service Admin capability).
--
-- Found missing during Product Owner acceptance: onboarding correctly
-- requires a current gym waiver, but no product surface let an admin
-- create one - CrossFit C15 had zero gym_waivers rows and the only path
-- forward was a manual production insert, which the Product Owner
-- explicitly rejected as a standing practice.
--
-- Preserves the existing, frozen model exactly: versioned waivers per gym,
-- "current" derived (never stored) via MAX(effective_date) WHERE
-- effective_date <= now(). This migration adds exactly one write path
-- (publish = always INSERT, never UPDATE) and closes an unrelated,
-- pre-existing grant gap found while auditing this table's security.

-- Security hardening, pre-existing and unrelated to this feature: this
-- project's ALTER DEFAULT PRIVILEGES auto-grants full table privileges
-- (including INSERT/UPDATE/DELETE/TRUNCATE) to authenticated on every new
-- table - the same root cause found twice already for functions. RLS
-- (enabled, verified live) currently backstops this correctly (no
-- permissive write policy exists, so Postgres denies by default), but the
-- grants themselves have no reason to exist: the only sanctioned write
-- path is the SECURITY DEFINER function below, callable only by
-- service_role. Revoking down to exactly what's used (SELECT, already
-- gated by gym_waivers_select_admin/is_admin(gym_id)).
revoke insert, update, delete, truncate on gym_waivers from authenticated;
revoke insert, update, delete, truncate on member_waiver_acceptances from authenticated;

alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated',
    'gym_waiver_published'
  ));

-- Publishes a new waiver version for the caller's own gym. Always INSERTs
-- a new row - historical rows are immutable from every code path, matching
-- Phase 2's "editing creates a new version" contract exactly. Version and
-- effective_date are both derived server-side, never trusted from the
-- client (Phase 3/4):
--
-- version: count of existing rows + 1 - matches the plain incrementing
-- string convention already used elsewhere ('1', '2', ...), no need to
-- parse/trust any existing version text.
--
-- effective_date: GREATEST(today, existing-max-for-this-gym + 1 day) -
-- guarantees UNIQUE(gym_id, effective_date) can never be violated by two
-- publishes on the same calendar day, without weakening that constraint.
-- If a version was already published today, the new one becomes current
-- starting tomorrow instead - the Edge Function surfaces this to the
-- caller so the Admin UI can disclose it honestly rather than implying
-- immediate effect.
create or replace function m9_publish_waiver(
  p_gym_id uuid,
  p_actor_admin_id uuid,
  p_title text,
  p_content_ref text
)
returns table (id uuid, version text, effective_date date, immediate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version int;
  v_max_effective date;
  v_effective_date date;
  v_new_id uuid;
begin
  if trim(p_title) = '' then
    raise exception 'invalid_title';
  end if;
  if trim(p_content_ref) = '' then
    raise exception 'invalid_content';
  end if;

  select count(*) + 1 into v_version from gym_waivers where gym_id = p_gym_id;
  select max(gym_waivers.effective_date) into v_max_effective from gym_waivers where gym_id = p_gym_id;
  v_effective_date := greatest(current_date, coalesce(v_max_effective + 1, current_date));

  insert into gym_waivers (gym_id, version, title, content_ref, effective_date, created_by)
  values (p_gym_id, v_version::text, trim(p_title), p_content_ref, v_effective_date, p_actor_admin_id)
  returning gym_waivers.id into v_new_id;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, null, 'gym_waiver_published');

  return query select v_new_id, v_version::text, v_effective_date, (v_effective_date <= current_date);
end;
$$;

revoke execute on function m9_publish_waiver(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function m9_publish_waiver(uuid, uuid, text, text) to service_role;
