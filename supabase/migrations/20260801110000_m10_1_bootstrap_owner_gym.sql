-- M10.1 Owner Authentication - Atomic Bootstrap.
--
-- Implements PENDING_OWNER_IMPLEMENTATION_CONTRACT.md Part 2 exactly:
-- Bootstrap is ONE SECURITY DEFINER RPC executing ONE Postgres transaction,
-- superseding the client-orchestrated, multi-write sequence the previous
-- M10.1 migration (20260801100000) still permitted via
-- gym_activation_state_bootstrap_insert / gym_commercial_state_bootstrap_
-- insert. This migration does not edit that earlier, already-committed
-- migration file (this project never edits migration history) - it revokes
-- what it granted, in a new migration, per established practice.
--
-- Per ADR-001, this RPC never needs to concern itself with an unverified
-- caller having no session at all - Bootstrap, by contract, is only ever
-- reachable by a caller who already has one. It re-checks
-- email_confirmed_at anyway (Invariant 2 - re-checked, never trusted from
-- context).

-- ============================================================
-- 1. Remove the client-facing bootstrap-insert policies. The only path to
--    gym_activation_state/gym_commercial_state creation is now the RPC
--    below - Invariant 4, "impossible outside Bootstrap," enforced
--    structurally, not by convention.
-- ============================================================

drop policy if exists gym_activation_state_bootstrap_insert on gym_activation_state;
drop policy if exists gym_commercial_state_bootstrap_insert on gym_commercial_state;

-- The INSERT grant itself (not just the RLS policy) is also removed - RLS
-- with no matching policy already denies every row, but this project has
-- already found, live, that relying on RLS alone without checking the
-- underlying grant is exactly how a gap goes unnoticed (the anon/gyms
-- SELECT-grant incident). authenticated keeps SELECT only from here on;
-- INSERT is granted to service_role alone (the RPC's own execution
-- context), matching every other Bootstrap-owned table in this project.
revoke insert on table gym_activation_state from authenticated;
revoke insert on table gym_commercial_state from authenticated;

-- ============================================================
-- 2. admin_audit_log.action_type - additive extension, same pattern M9
--    has already used repeatedly (drop + re-add with the expanded list).
--    One new value: owner_gym_bootstrapped.
--
--    The list below is the full, live constraint as it actually exists in
--    production - confirmed directly against the database
--    (pg_get_constraintdef), not reconstructed from migration file
--    history. An earlier draft of this migration reconstructed the list
--    from only two of the four migrations that have ever touched this
--    constraint and was missing two values two later M9 migrations had
--    already added (member_invitation_resent, gym_waiver_published) -
--    caught by the constraint violation this migration produced on its
--    first deploy attempt against production, before anything else in
--    this migration had committed (the failed statement's own transaction
--    rolled back cleanly; the two prior M10.1 migrations in this batch
--    had already committed independently and were unaffected).
-- ============================================================

alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated',
    'gym_waiver_published',
    'owner_gym_bootstrapped'
  ));

-- ============================================================
-- 3. bootstrap_owner_gym - the sole Bootstrap mechanism.
--
-- Creates, in this order, in this one transaction: gyms, admins,
-- gym_activation_state, gym_commercial_state (trial started immediately -
-- by contract, Bootstrap never runs before verification, so there is no
-- intermediate "unverified" activation state to pass through here, unlike
-- the trigger-based approach the earlier M10.1 migration still contains -
-- see step 4 below for why those triggers are now dead code, not deleted).
-- Then claims profiles.gym_id and writes the audit entry. All in the same
-- transaction: all five succeed, or none do.
--
-- Idempotency (PENDING_OWNER_IMPLEMENTATION_CONTRACT.md Part 2 +
-- Self-Review): layer 1 is the existence check at the top - a repeat call
-- (double click, retry after a lost response) returns the already-created
-- Gym rather than attempting anything. Layer 2 is the unique_violation
-- handler around the admins insert - the backstop for a genuine race
-- between two concurrent calls for the SAME identity, where both could
-- pass layer 1 before either commits. Layer 2 for gym-name collisions is
-- separate and is a real, expected business outcome (two different
-- Owners choosing the same name), not a race to swallow - it is
-- surfaced to the caller as a distinguishable 'gym_name_taken' error,
-- never a raw constraint violation.
create or replace function bootstrap_owner_gym(p_gym_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_existing_gym_id uuid;
  v_gym_id uuid;
  v_email text;
  v_confirmed timestamptz;
  v_join_code text;
  v_constraint text;
begin
  if v_owner_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Idempotency, layer 1: already bootstrapped (repeat call).
  select gym_id into v_existing_gym_id from admins where id = v_owner_id;
  if v_existing_gym_id is not null then
    return v_existing_gym_id;
  end if;

  -- ADR-001 Invariant 2, re-checked here rather than trusted from the
  -- caller's context - a caller with a session is not, by itself, proof
  -- the session's identity is verified.
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = v_owner_id;
  if v_confirmed is null then
    raise exception 'not_verified';
  end if;

  if p_gym_name is null or length(trim(p_gym_name)) = 0 then
    raise exception 'gym_name_required';
  end if;

  v_gym_id := gen_random_uuid();
  -- Generated server-side, never accepted from the caller - the client
  -- has no legitimate reason to choose its own join code, and a
  -- caller-supplied value would be an unnecessary trust surface.
  v_join_code := upper(substr(md5(v_gym_id::text || clock_timestamp()::text), 1, 7));

  begin
    insert into gyms (id, name, join_code, owner_id)
      values (v_gym_id, trim(p_gym_name), v_join_code, v_owner_id);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'gyms_name_key' then
      raise exception 'gym_name_taken';
    end if;
    -- join_code collision: not a business outcome, not caller-caused
    -- (the code is internally generated) - re-raise as-is rather than
    -- inventing a retry loop for a ~1-in-78-billion event this project's
    -- own existing join-code generation already accepts the same risk on.
    raise;
  end;

  begin
    insert into admins (id, email, gym_id) values (v_owner_id, v_email, v_gym_id);
  exception when unique_violation then
    -- Idempotency, layer 2: lost a genuine race to another concurrent
    -- Bootstrap call for this SAME identity. Resolve to the winner's Gym,
    -- never surface the raw constraint violation to the caller.
    select gym_id into v_existing_gym_id from admins where id = v_owner_id;
    return v_existing_gym_id;
  end;

  insert into gym_activation_state (gym_id, owner_admin_id, activation_state)
    values (v_gym_id, v_owner_id, 'onboarding');

  insert into gym_commercial_state (gym_id, commercial_state, trial_started_at, trial_ends_at)
    values (v_gym_id, 'trial_running', now(), now() + interval '14 days');

  update profiles set gym_id = v_gym_id where id = v_owner_id;

  perform m9_write_audit_entry(v_gym_id, v_owner_id, null, 'owner_gym_bootstrapped');

  return v_gym_id;
end;
$$;

-- Callable directly by the client's own authenticated session (Bootstrap
-- has no external API dependency, so - per
-- OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 7's own Edge
-- Function boundary rule - it belongs in SQL, not behind an Edge
-- Function). New function, so the create-then-explicit-grant pattern in
-- this same migration is safe (the auto-grant/lockdown hazard this
-- project has hit twice applies to DROP+RECREATE of an EXISTING function,
-- not to a function's first creation).
revoke execute on function bootstrap_owner_gym(text) from public, anon;
grant execute on function bootstrap_owner_gym(text) to authenticated;

-- ============================================================
-- 4. The three reactive triggers from the previous M10.1 migration
--    (on_owner_email_verified, evaluate_first_value, evaluate_activation)
--    are NOT dropped here. evaluate_first_value and evaluate_activation
--    remain fully correct and necessary - they observe the Member Domain's
--    own write paths (member_waiver_acceptances, gym_invitations) and have
--    nothing to do with how or when a Gym itself was created.
--    on_owner_email_verified is now unreachable in practice (Bootstrap, by
--    contract, only ever runs after verification, so activation_state
--    never starts at 'unverified' for a Gym that exists at all - there is
--    no longer a later UPDATE for it to react to) but is left in place
--    rather than dropped: it is harmless (fires on zero matching rows),
--    and remains the correct backstop for the one still-open item named in
--    M10_1's original implementation report - if enable_confirmations is
--    ever turned on and some future path still creates a Gym ahead of
--    full confirmation, this trigger is already there to catch it. Removing
--    it now would be deleting a safety net for a risk this project has
--    already flagged as open, not yet closed.
-- ============================================================
