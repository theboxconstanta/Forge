-- M7.3 Step 5 - Gym Transfer: Transfer Code schema.
--
-- Per M7.2 Technical Architecture Section 7 (Database Architecture) and
-- Section 5 (New Technical Components): Transfer Code is a new,
-- dedicated entity - not an extension of gym_signup_codes, which is
-- gym-scoped and reusable across many joiners, the opposite of what a
-- Transfer Code must be (scoped to one specific Transferred Membership
-- and one specific Member). gym_signup_codes itself is untouched by this
-- migration.
--
-- Columns hold exactly what Section 7 names as the entity's content: the
-- Transferred Membership it belongs to (membership_id), the Member
-- identity it resolves to (member_id), its current state (status), when
-- and by whom it was issued (issued_at/issued_by), and when it reached a
-- Terminal State (resolved_at) - "how" is already captured by status
-- itself, per Section 9's state machine (Active -> Used | Revoked |
-- Superseded, all terminal). gym_id is the origin gym - denormalized
-- directly on the row, matching the existing convention already used by
-- memberships/subscriptions/orders/payments, so the RLS policy below can
-- use the same is_admin(gym_id) check already used throughout this
-- schema without a join.
--
-- Scope boundary, explicit: this migration is schema and RLS only. No
-- RPC exists yet to issue, revoke, or redeem a code (M7.3 Task 3.2, Step
-- 6) - the Business Rule 8/9 exclusivity guarantee (at most one Active
-- code per Transfer) is that RPC's stated responsibility, not enforced
-- here. No trigger change exists yet for the ordinary-journey-completion
-- supersession path (M7.3 Task 3.3, Step 7). Per M7.2 Section 16, this
-- table's only intended writers are those future SECURITY DEFINER RPCs
-- and the synchronization trigger's future supersession extension -
-- consistent with that, no INSERT/UPDATE/DELETE RLS policy is added now;
-- with RLS enabled and only a SELECT policy defined, no authenticated
-- role can write to this table directly through PostgREST at all.
--
-- RLS: per M7.2 Section 12, only an administrator of the Transferred
-- Membership's own (origin) gym may see a Transfer Code. Destination-gym
-- administrators are deliberately granted no SELECT access here at all -
-- redemption validation ("a code was presented") is a narrow, future
-- SECURITY DEFINER lookup (Step 10), never a broad table read, so that a
-- redeeming administrator can never browse or learn which gym issued a
-- code.
--
-- Rollback: drop table transfer_codes.

create table transfer_codes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  membership_id uuid not null references memberships(id),
  member_id uuid not null references members(id),
  code text not null,
  status text not null default 'active' check (status in ('active', 'used', 'revoked', 'superseded')),
  issued_at timestamptz not null default now(),
  issued_by uuid not null references admins(id),
  resolved_at timestamptz,
  constraint transfer_codes_code_key unique (code)
);

create index transfer_codes_gym_id_idx on transfer_codes (gym_id);
create index transfer_codes_membership_id_idx on transfer_codes (membership_id);

alter table transfer_codes enable row level security;

create policy transfer_codes_select_origin_admin on transfer_codes
  for select to authenticated
  using (is_admin(gym_id));
