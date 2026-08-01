-- M10.1 Owner Authentication - Gym Lifecycle State foundation.
--
-- Governed by: OWNER_LIFECYCLE_STATE_MACHINE.md (the two-axis FSM),
-- OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.1 (the split),
-- M10_1_IMPLEMENTATION_STRATEGY.md (reuse of the existing owner-bootstrap
-- sequence and the existing `admins` identity mechanism).
--
-- Two separate tables, deliberately never one - OWNER_LIFECYCLE_STATE_
-- MACHINE.md Section 6 requires that only the commercial axis may ever
-- block product access; a merged table would let a future access check
-- accidentally read activation_state where it meant commercial_state.
--
-- owner_admin_id references admins(id), not a profiles role column -
-- "Admin" in this codebase is already a separate table (checkAdmin() in
-- App.jsx queries it directly), not a role field on profiles. Owner reuses
-- that exact, already-proven identity mechanism.

create table gym_activation_state (
  gym_id uuid primary key references gyms(id),
  owner_admin_id uuid not null references admins(id),
  activation_state text not null default 'unverified'
    check (activation_state in ('unverified', 'onboarding', 'first_value_reached', 'activated')),
  first_value_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create table gym_commercial_state (
  gym_id uuid primary key references gyms(id),
  commercial_state text
    check (commercial_state in ('trial_running', 'trial_ending', 'expired', 'paying', 'past_due', 'cancelled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  -- No FK yet - platform_subscriptions does not exist until M10.5. A plain
  -- uuid column is reserved now so that milestone adds the constraint, not
  -- the column (M10_IMPLEMENTATION_PLAN.md's own additive-migration rule).
  platform_subscription_id uuid,
  created_at timestamptz not null default now()
);

create index gym_activation_state_owner_admin_id_idx on gym_activation_state (owner_admin_id);

alter table gym_activation_state enable row level security;
alter table gym_commercial_state enable row level security;

-- Read: any Admin of the gym. is_admin(gid) already exists and is already
-- the proven pattern for every other gym-scoped table (gyms_admin_update,
-- gym_invitations_select_admin) - reused verbatim, not re-derived.
create policy gym_activation_state_select_admin on gym_activation_state
  for select to authenticated
  using (is_admin(gym_id));

create policy gym_commercial_state_select_admin on gym_commercial_state
  for select to authenticated
  using (is_admin(gym_id));

-- Bootstrap insert: same shape as the existing admins_bootstrap_own_gym
-- policy - the just-registered owner may insert exactly one row for the
-- gym they just proved ownership of (an admins row already exists for
-- them, for that gym), never for any other gym. No UPDATE policy for any
-- client role at any privilege level - every transition after creation is
-- written exclusively by the SECURITY DEFINER trigger functions in the
-- companion migration (20260801100100).
create policy gym_activation_state_bootstrap_insert on gym_activation_state
  for insert to authenticated
  with check (
    owner_admin_id = auth.uid()
    and exists (select 1 from admins where id = auth.uid() and gym_id = gym_activation_state.gym_id)
  );

create policy gym_commercial_state_bootstrap_insert on gym_commercial_state
  for insert to authenticated
  with check (
    exists (select 1 from admins where id = auth.uid() and gym_id = gym_commercial_state.gym_id)
  );

-- Explicit table grants, not left to RLS alone - this project has already
-- found, live, that an RLS policy with no matching base GRANT fails
-- silently rather than erroring (the anon/gyms SELECT gap, 07-15). No
-- grant to anon at all here: these tables are never read pre-auth.
grant select, insert on table gym_activation_state to authenticated;
grant select, insert on table gym_commercial_state to authenticated;
grant all on table gym_activation_state to service_role;
grant all on table gym_commercial_state to service_role;
