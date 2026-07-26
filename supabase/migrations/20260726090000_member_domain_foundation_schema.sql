-- M1.1 - Member Domain Foundation (Schema Introduction)
--
-- Introduces the Member/Membership split defined by the frozen Member
-- Domain Architecture (Section 3, Section 7) as two new, empty, additive
-- tables. Nothing existing is modified, no data is migrated, and no
-- existing read/write path changes.
--
-- Naming note: an existing `members` table already occupies the natural
-- name for the Member entity. Live-data validation (M1 readiness gate)
-- confirmed it is currently empty and entirely unreferenced in practice
-- (subscriptions.member_id, its only foreign key, is 0% populated across
-- all 178 rows), but no certified decision has been made on whether to
-- reuse, replace, or retire it - that disposition is explicitly out of
-- scope for schema introduction. `member_identities` is used here so
-- this migration does not presume that decision, while still
-- introducing the entity the frozen architecture requires.

-- Member: platform-scoped identity, independent of any Gym (Member
-- Domain Architecture Section 3). One Member <-> one auth login in the
-- base model, mirroring the same 1:1 relationship "profiles.id" already
-- has with auth.users.
create table member_identities (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table member_identities enable row level security;

grant all on table member_identities to anon;
grant all on table member_identities to authenticated;
grant all on table member_identities to service_role;

create index member_identities_email_idx on member_identities (email);

-- Membership: the Gym-scoped relationship anchor ("this Member, this
-- Gym") - Member Domain Architecture Section 7.1. The three status
-- values below are exactly the three states that section already
-- freezes (active, removed, transferred); none is invented here. The
-- table starts empty - no existing Membership data exists anywhere to
-- migrate into it yet (M1.2).
create table memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references member_identities(id),
  gym_id uuid not null references gyms(id),
  status text not null default 'active' check (status in ('active', 'removed', 'transferred')),
  created_at timestamptz not null default now()
);

alter table memberships enable row level security;

grant all on table memberships to anon;
grant all on table memberships to authenticated;
grant all on table memberships to service_role;

create index memberships_gym_id_idx on memberships (gym_id);
create index memberships_member_id_idx on memberships (member_id);

-- Reuses the existing, already-proven gym_id-immutability trigger
-- function (see multitenant migrations) rather than defining a new one -
-- a Membership's Gym is fixed once set, exactly as the same rule already
-- applies to every other gym-scoped table in this schema.
create trigger prevent_gym_id_change_trg
  before update on memberships
  for each row execute function prevent_gym_id_change();
