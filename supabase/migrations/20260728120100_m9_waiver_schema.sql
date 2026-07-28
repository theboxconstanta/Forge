-- M9 Invite Member & Onboarding - Waiver domain.
--
-- Per the Product + Architecture Decision Report Section 18/19 and the
-- Auth Spike gate's binding waiver-determinism correction: gym_waivers
-- carries no is_current boolean - "current" is derived as the row with the
-- latest effective_date <= now() for a Gym, made deterministic (not merely
-- convenient) by the UNIQUE(gym_id, effective_date) constraint below,
-- which is the one, minimal fix the determinism review actually required.
create table gym_waivers (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  version text not null,
  title text not null,
  content_ref text not null,
  effective_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (gym_id, effective_date)
);

create index gym_waivers_gym_id_idx on gym_waivers (gym_id, effective_date desc);

alter table gym_waivers enable row level security;

create policy "gym_waivers_select_admin" on gym_waivers
  for select to authenticated
  using (is_admin(gym_id));

grant select on table gym_waivers to authenticated;
grant all on table gym_waivers to service_role;

comment on table gym_waivers is
  'M9 Waiver definitions (Product + Architecture Decision Report Section 18). "Current" is derived (latest effective_date <= now()), never stored - see UNIQUE(gym_id, effective_date) for why this derivation is deterministic.';

-- member_waiver_acceptances: consent evidence, append-only, never edited -
-- the same "ledger, never a record you edit" discipline the Financial
-- Domain already applies to Payments. Bound to membership_id, not a raw
-- (member_id, gym_id) pair, per the Engineering Director Challenge
-- Report's own refinement: each Gym Transfer produces a new Membership row
-- (never a reactivated one), so keying acceptance to the specific
-- relationship instance is the more precise, already-consistent choice.
create table member_waiver_acceptances (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships(id),
  waiver_id uuid not null references gym_waivers(id),
  accepted_at timestamptz not null default now()
);

create index member_waiver_acceptances_membership_idx on member_waiver_acceptances (membership_id);

alter table member_waiver_acceptances enable row level security;

-- Visible to the Member themselves (via their own Membership) or an admin
-- of the Gym that Membership belongs to - mirrors memberships_select_own_or_admin
-- exactly, joined through membership_id since this table has no gym_id/
-- member_id column of its own.
create policy "member_waiver_acceptances_select_own_or_admin" on member_waiver_acceptances
  for select to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.id = member_waiver_acceptances.membership_id
        and (m.member_id = auth.uid() or is_admin(m.gym_id))
    )
  );

grant select on table member_waiver_acceptances to authenticated;
grant all on table member_waiver_acceptances to service_role;

comment on table member_waiver_acceptances is
  'M9 Waiver acceptance evidence (Product + Architecture Decision Report Section 18-19). Append-only - no update/delete policy for any role, ever. Written exclusively via Final Commit''s own SECURITY DEFINER function, in the same transaction as the resulting Member/Gym Membership.';

alter table gym_waivers replica identity full;
alter table member_waiver_acceptances replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'gym_waivers') then
    alter publication supabase_realtime add table gym_waivers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'member_waiver_acceptances') then
    alter publication supabase_realtime add table member_waiver_acceptances;
  end if;
end $$;
