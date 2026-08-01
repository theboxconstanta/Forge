-- M10.1 Owner Authentication - reactive Gym Lifecycle State triggers.
--
-- Three triggers, each observing an EXISTING write path without modifying
-- it (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Principle 3.3 / Section
-- 6.2). None of these alter handle_new_user(), any m9_final_commit_*
-- function, or m9_write_invitation - each is a trigger on the table that
-- write path already writes to, invisible to the Member Domain entirely.
--
-- Each function is SECURITY DEFINER, the same pattern handle_new_user()
-- already uses to write into RLS-protected tables regardless of the
-- triggering role's own privileges.
--
-- No separate grant-lockdown migration follows this one, unlike the M9.1
-- precedent (20260801090000/20260801090100) - that precedent applies to
-- ordinary callable RPCs, where a stray EXECUTE grant to anon/authenticated
-- is a real, callable attack surface. These three functions all RETURN
-- TRIGGER, which Postgres refuses to invoke via a direct function call
-- under any grant - there is no direct-call surface to lock down.

-- 1. on_owner_email_verified: auth.users.email_confirmed_at transitioning
-- from null to non-null is Supabase's own native confirmation signal,
-- reused verbatim rather than a bespoke verification mechanism. Scoped by
-- its own WHERE clauses to rows that are actually an unverified Owner -
-- fires harmlessly (zero rows updated) for every other role's auth.users
-- row. This is a backstop for when email confirmation genuinely happens
-- after signup as a later UPDATE; the common case today (auto-confirm at
-- INSERT time, since enable_confirmations=false) is instead handled
-- directly by the owner-registration client code inserting the correct
-- starting state up front (see App.jsx handleRegister) - both paths reach
-- the same result, from whichever moment email_confirmed_at actually
-- becomes true.
create or replace function on_owner_email_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update gym_activation_state
      set activation_state = 'onboarding'
      where owner_admin_id = new.id and activation_state = 'unverified';

    update gym_commercial_state gcs
      set commercial_state = 'trial_running',
          trial_started_at = now(),
          trial_ends_at = now() + interval '14 days'
      from gym_activation_state gas
      where gas.gym_id = gcs.gym_id
        and gas.owner_admin_id = new.id
        and gcs.commercial_state is null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_owner_email_verified_trg on auth.users;
create trigger on_owner_email_verified_trg
  after update of email_confirmed_at on auth.users
  for each row execute function on_owner_email_verified();

-- 2. evaluate_first_value: observes member_waiver_acceptances - the one
-- write common to all three m9_final_commit_* functions (existing,
-- dormant, and new-prospect paths) at the exact moment Final Commit
-- succeeds. A more reliable single observation point than `memberships`,
-- since a membership row can already exist before Final Commit on the
-- existing/dormant paths and would not fire a fresh INSERT there.
create or replace function evaluate_first_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  select gym_id, member_id into v_gym_id, v_member_id
    from memberships where id = new.membership_id;

  update gym_activation_state
    set activation_state = 'first_value_reached', first_value_at = now()
    where gym_id = v_gym_id
      and activation_state = 'onboarding'
      -- Precision required by OWNER_ACTIVATION_ARCHITECTURE.md Section 7:
      -- the Owner's own test pass through their own invitation flow does
      -- not count. members.id and admins.id are both the auth.users id
      -- itself, so this is a direct identity comparison, not a lookup.
      and owner_admin_id <> v_member_id;

  return new;
end;
$$;

drop trigger if exists evaluate_first_value_trg on member_waiver_acceptances;
create trigger evaluate_first_value_trg
  after insert on member_waiver_acceptances
  for each row execute function evaluate_first_value();

-- 3. evaluate_activation: a deliberately narrow first implementation.
-- Wired to exactly one qualifying operating action - the Owner sending a
-- further Member invitation - on a calendar day distinct from both Gym
-- creation and First Value, per OWNER_LIFECYCLE_STATE_MACHINE.md Principle
-- 3.16's day-distinctness requirement and Section 8's "any other real use
-- of the product" language. Broadening this to other operating actions
-- (schedule edits, roster management, a future Admin Invitation, etc.)
-- touches those features' own write paths and is explicitly out of scope
-- for M10.1 - named in M10_1_IMPLEMENTATION_REPORT.md's Remaining Risks,
-- not silently expanded here.
create or replace function evaluate_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gas gym_activation_state%rowtype;
  v_gym_created_on date;
begin
  select * into v_gas from gym_activation_state
    where gym_id = new.gym_id and owner_admin_id = new.invited_by and activation_state = 'first_value_reached';
  if not found then
    return new;
  end if;

  select created_at::date into v_gym_created_on from gyms where id = new.gym_id;

  if new.created_at::date <> v_gas.first_value_at::date and new.created_at::date <> v_gym_created_on then
    update gym_activation_state
      set activation_state = 'activated', activated_at = now()
      where gym_id = new.gym_id;
  end if;

  return new;
end;
$$;

drop trigger if exists evaluate_activation_trg on gym_invitations;
create trigger evaluate_activation_trg
  after insert on gym_invitations
  for each row execute function evaluate_activation();
