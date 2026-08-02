-- M10.3 Admin Invitation - schema.
--
-- admin_invitations: same token-hash/expiry/single-use shape as
-- gym_invitations (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section
-- 5.5), deliberately a separate table - accepting one grants an Admin role,
-- never a Membership, and has no member_id/email-challenge fields at all
-- (M9.1 already established that a possession-based token alone is
-- sufficient; there is no reason for this table to carry the OTP-era
-- fields gym_invitations itself no longer uses).

create table admin_invitations (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  invited_email text not null,
  invited_by uuid not null references auth.users(id),
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create index admin_invitations_gym_id_idx on admin_invitations (gym_id, created_at desc);

-- At most one outstanding invitation per (gym, email) - identical rule and
-- identical reason to gym_invitations_one_outstanding_idx (Product
-- Specification Section 4.2 Rule 2, reused here for the same shape of
-- problem).
create unique index admin_invitations_one_outstanding_idx on admin_invitations (gym_id, lower(invited_email))
  where accepted_at is null and revoked_at is null;

alter table admin_invitations enable row level security;

-- Read-only for the Gym's own Admins. No INSERT/UPDATE/DELETE policy for
-- authenticated at any privilege level - every write happens through the
-- SECURITY DEFINER RPCs in the companion migration, callable only by
-- service_role, mirroring gym_invitations' own "written exclusively via
-- SECURITY DEFINER functions" discipline exactly.
create policy "admin_invitations_select_admin" on admin_invitations
  for select to authenticated
  using (is_admin(gym_id));

grant select on table admin_invitations to authenticated;
grant all on table admin_invitations to service_role;

comment on table admin_invitations is
  'M10.3 Admin Invitation (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.5). Invitation lifecycle only - grants an Admin role on acceptance, never a Membership. Written exclusively via SECURITY DEFINER functions callable only by service_role.';

alter table admin_invitations replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'admin_invitations'
  ) then
    alter publication supabase_realtime add table admin_invitations;
  end if;
end $$;

-- admin_audit_log.action_type - additive extension, same pattern already
-- used four times in this project's history (M9 twice, M10.1 once).
-- Reconstructed from the table's actual live definition (pg_get_
-- constraintdef), not from migration-file history alone - the exact
-- discipline M10.1's own deployment incident established as necessary.
alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated',
    'gym_waiver_published',
    'owner_gym_bootstrapped',
    'admin_invited', 'admin_invitation_accepted', 'admin_invitation_revoked'
  ));
