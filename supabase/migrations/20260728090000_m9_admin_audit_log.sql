-- M9 Increment 1 - Administrative Audit Log (foundation)
--
-- Introduces the Audit Log business concept defined by M9_PRODUCT_SPECIFICATION.md
-- Section 2 and Section 4.10, per ADR-004 (Tier 3 - Audit Record, unconditional,
-- no derivation). This migration is schema-only: the table, its one RLS policy,
-- and its realtime publication membership. No writer exists yet - that is
-- introduced by the paired migration (20260728090100) and consumed for the
-- first time by the admin-add-member Edge Function (Increment 1's own
-- business capability, Manual Member Enrollment).
--
-- Scope boundary, explicit: this table records administrator-invoked M9
-- actions only (Product Specification Section 4.10, Rule 1 - "every action
-- defined in this document"). It is not a general application event log and
-- is not a Financial Domain audit mechanism (Financial Domain Architecture
-- Section 2, Non-Goals: "a dedicated financial audit log is outside the
-- scope of the Financial Domain" - deliberately left alone here, unchanged).
--
-- Naming: admin_audit_log, not audit_log - reflects precisely what Section
-- 4.10 defines ("who performed each administrator-invoked action"), and
-- avoids colliding with a future, differently-scoped platform log if one is
-- ever introduced.

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  actor_admin_id uuid not null references auth.users(id),
  member_id uuid references members(id),
  action_type text not null check (action_type in ('member_added_new', 'member_added_existing')),
  outcome text not null default 'success' check (outcome in ('success')),
  created_at timestamptz not null default now()
);

create index admin_audit_log_gym_id_idx on admin_audit_log (gym_id, created_at desc);
create index admin_audit_log_member_id_idx on admin_audit_log (member_id);

alter table admin_audit_log enable row level security;

-- Read-only for the Gym's own administrators (Product Specification Section
-- 4.10, Rule 2 - tenant isolation). No INSERT/UPDATE/DELETE policy for any
-- client role, for any actor - Rule 3 ("never edited or removed by any
-- action in this document") and the same "writes only through a narrow,
-- service-role-gated function" discipline already established for
-- transfer_codes (Gym Transfer) and members/memberships (Member Domain).
create policy "admin_audit_log_select_admin" on admin_audit_log
  for select to authenticated
  using (is_admin(gym_id));

-- No blanket grant to anon/authenticated - unlike the pre-existing legacy
-- grants on members/memberships (M1.1, carried forward only because RLS
-- already defaulted to deny), this is a new table with no such history to
-- preserve. SELECT is enforced by RLS above; INSERT/UPDATE/DELETE are
-- reachable only through the SECURITY DEFINER functions in the paired
-- migration, callable only by service_role.
grant select on table admin_audit_log to authenticated;
grant all on table admin_audit_log to service_role;

comment on table admin_audit_log is
  'M9 Audit Log (Product Specification Section 4.10, ADR-004 Tier 3). Record of fact for administrator-invoked M9 actions. Written exclusively via SECURITY DEFINER functions callable only by service_role - never directly by an authenticated client.';

-- Realtime: added now (Increment 1) even though no UI reads this table yet
-- (that arrives with the Timeline/Audit Visibility increment) - matches
-- this migration's own foundation-first scope and lets every future M9
-- write capability rely on the publication already being correctly
-- configured, not re-verify it each time.
alter table admin_audit_log replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'admin_audit_log'
  ) then
    alter publication supabase_realtime add table admin_audit_log;
  end if;
end $$;
