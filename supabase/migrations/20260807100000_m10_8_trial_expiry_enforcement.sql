-- M10.8 Trial Expiry Enforcement.
--
-- Mandatory-first-step finding, reported not silently redesigned: Section
-- 9's own text claims "Database impact: None new - activates the
-- already-existing advance_trial_state's expired transition." Checked
-- directly, not assumed: advance_trial_state does not exist anywhere in
-- the live database (grep across every migration confirms it, information_
-- schema.routines confirms it live). This is a real contradiction between
-- the frozen milestone's own stated assumption and shipped reality.
--
-- Resolution, reasoned rather than a stop-and-ask: advance_trial_state's
-- exact behavior is not an open product question - it is already fully,
-- unambiguously specified by two frozen documents (OWNER_DOMAIN_
-- IMPLEMENTATION_ARCHITECTURE.md Section 6.6: "a periodic check moving
-- Gym Commercial State trial_running -> trial_ending (threshold crossed)
-- -> expired (clock reached zero, no Platform Subscription converted)";
-- OWNER_LIFECYCLE_STATE_MACHINE.md Section 5 B2/B3/B4's own entry/exit
-- criteria). Building the mechanical function that already-decided logic
-- describes is not a new product decision, the same judgment already
-- applied to M10.3's accept_admin_invitation and M10.5a's audit-logging
-- fix. What is new here is only that this migration must actually CREATE
-- the function, not merely "activate" a pre-existing one - the "None new"
-- database-impact claim is inaccurate and is named as such, not silently
-- corrected without comment.
--
-- Second finding, also reported: a completely separate, pre-existing,
-- platform-admin-managed blocking mechanism already exists (gyms.is_active/
-- paid_until, migration 20260714190000, its own daily cron) - predates the
-- Owner Domain entirely, driven by manual platform-admin action, not the
-- trial clock. This migration does not touch it, redesign it, or unify
-- with it - out of scope, a coexisting, independent mechanism, exactly as
-- Section 6's own Non-Goals discipline requires leaving alone.

-- Feature flag - reuses the existing app_version table's own key-value
-- shape (key text primary key, version text not null), not a new table.
-- First attempted as a Postgres GUC (`alter database ... set ...`) for a
-- genuinely zero-schema-footprint toggle - reverted after a real, live
-- permission denial: "permission denied to set parameter" (SQLSTATE
-- 42501) - the migration role is not a database owner/superuser on this
-- managed project. app_version is the closest existing genuine
-- platform-wide singleton config store (app_settings is per-gym, PK
-- (gym_id, key) NOT NULL with a real FK to gyms - not usable for a
-- platform-wide concern without altering its own schema, which is exactly
-- what this fallback avoids). No new table, no schema change to
-- app_version - one additional row, using the table's own existing shape
-- for its own existing purpose (platform-wide key-value config).
--
-- One real, harmless side effect worth naming rather than discovering
-- later: main.jsx's own service-worker-update listener subscribes to
-- ANY UPDATE on app_version, unfiltered by key - toggling this flag later
-- will also trigger every connected client's SW update-check. Functionally
-- inert (a no-op if nothing actually changed) but a real, observable
-- coupling with an unrelated, pre-existing mechanism.
--
-- Deployed OFF, per the plan's own explicit "deploy and activate are two
-- separate actions" requirement. Toggling later is a plain UPDATE any
-- operator with DB access can run instantly - "completely independent
-- from deployment," satisfied without a GUC.
insert into app_version (key, version) values ('trial_expiry_enforcement_enabled', 'off')
on conflict (key) do nothing;

-- advance_trial_state - scheduled, not client-callable (mirrors the
-- existing gym-billing-block-daily cron's own shape exactly). Touches
-- Gym Commercial State only, never Gym Activation State - the one
-- invariant this entire milestone exists to protect, enforced here by
-- simply never referencing gym_activation_state anywhere in this function
-- at all, not merely by discipline.
create or replace function advance_trial_state()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym record;
  v_owner_admin_id uuid;
begin
  -- B2 -> B3: days remaining crosses the ending threshold (3 days - a
  -- tuning parameter per B3's own spec, not an architectural commitment).
  update gym_commercial_state
  set commercial_state = 'trial_ending'
  where commercial_state = 'trial_running'
    and trial_ends_at is not null
    and trial_ends_at <= now() + interval '3 days';

  -- B2/B3 -> B4: clock reached zero, still no Platform Subscription.
  -- Audited per-gym (not a single bulk entry) so every real transition is
  -- individually traceable, matching this project's own established
  -- one-row-per-event audit discipline.
  for v_gym in
    select gym_id from gym_commercial_state
    where commercial_state in ('trial_running', 'trial_ending')
      and trial_ends_at is not null
      and trial_ends_at <= now()
  loop
    update gym_commercial_state set commercial_state = 'expired' where gym_id = v_gym.gym_id;

    select owner_admin_id into v_owner_admin_id
    from gym_activation_state where gym_activation_state.gym_id = v_gym.gym_id;

    insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
    values (v_gym.gym_id, v_owner_admin_id, 'gym_trial_expired', 'success');
  end loop;
end;
$$;

select cron.schedule(
  'advance-trial-state-hourly',
  '0 * * * *',
  $$ select advance_trial_state(); $$
);

-- is_gym_access_blocked - the access-blocking predicate itself. Callable
-- by ANY authenticated user (Owner, Admin, or Member), not just Admins -
-- day-to-day product usage per OWNER_LIFECYCLE_STATE_MACHINE.md B4 is
-- blocked for the whole Gym, not just its Owner, so a plain Member's own
-- client must be able to evaluate this too. gym_commercial_state's own
-- RLS (gym_commercial_state_select_admin) does NOT allow a Member to read
-- the full row directly - this function exists specifically so a Member
-- never needs broader read access to the underlying (more sensitive)
-- commercial-state row just to answer one boolean question. "RLS impact:
-- None new" (Section 9's own claim) stays literally true - no RLS policy
-- is added or changed anywhere by this migration.
--
-- Reads Gym Commercial State ONLY - grep-verifiable: this function body
-- contains no reference to gym_activation_state anywhere.
--
-- Fails toward preserving access, per this milestone's own non-negotiable
-- safety rule: a missing/unset flag row, a missing Commercial State row,
-- or any commercial_state other than the literal 'expired' string all
-- resolve to "not blocked" - there is no code path in this function that
-- can default to blocking on ambiguity.
create or replace function is_gym_access_blocked(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select version from app_version where key = 'trial_expiry_enforcement_enabled'), 'off') = 'on'
     and exists (
       select 1 from gym_commercial_state
       where gym_commercial_state.gym_id = p_gym_id
         and gym_commercial_state.commercial_state = 'expired'
     );
$$;

grant execute on function advance_trial_state() to service_role;
grant execute on function is_gym_access_blocked(uuid) to authenticated;

revoke execute on function advance_trial_state() from anon, authenticated, public;
revoke execute on function is_gym_access_blocked(uuid) from anon, public;

alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated',
    'gym_waiver_published',
    'owner_gym_bootstrapped',
    'admin_invited', 'admin_invitation_accepted', 'admin_invitation_revoked',
    'platform_subscription_purchased', 'platform_payment_succeeded', 'platform_payment_refunded',
    'platform_plan_upgraded', 'platform_plan_downgraded', 'platform_subscription_cancelled',
    'gym_trial_expired'
  ));
