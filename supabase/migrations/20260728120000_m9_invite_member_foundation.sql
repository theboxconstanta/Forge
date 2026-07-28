-- M9 Invite Member & Onboarding - foundation schema.
--
-- Governed by: MEMBER_DOMAIN_ARCHITECTURE.md D9 (members.phone), the M9
-- Engineering Director Challenge Report (gym_invitations shape - no draft
-- PII, email-challenge state only), and the M9 Final Auth-Handoff Security
-- Report (keyed-HMAC challenge storage, resend/attempt bounds).
--
-- members.phone: global Member identity data, per D9 - same table, same
-- nullability discipline as every other identity field already there.
alter table members add column phone text;

-- admin_audit_log action_type: extend, not replace. member_added_new/
-- member_added_existing (Increment 1) are untouched. Four new types, per
-- the Auth Spike gate's own binding audit-semantics correction:
--   member_invited / member_invitation_revoked - administrator accountability.
--   member_onboarding_completed - a newly invited person's own completed
--     onboarding (actor = the invitee, not an administrator - the first
--     M9 case where actor and subject are the same person).
--   member_app_activated - an already-existing manually-added Member's own
--     completed activation (actor = the invitee).
-- Deliberately NOT added: a "resent" action type (Challenge Report
-- conclusion - would drift toward an event store) and waiver acceptance
-- (lives exclusively in member_waiver_acceptances, per the Product +
-- Architecture Decision Report's own Section 19 distinction).
alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked',
    'member_onboarding_completed', 'member_app_activated'
  ));

-- gym_invitations: pure invitation-lifecycle facts plus the narrow
-- email-challenge state the Auth-Handoff report proved is the only way to
-- verify email control before auth.users exists (Model D). No draft
-- profile data (first_name/last_name/phone/birth_date/waiver) lives here -
-- that stays client-side until Final Commit, per the Engineering Director
-- Challenge Report's own reversal of the original design.
create table gym_invitations (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  invited_email text not null,
  invited_by uuid not null references auth.users(id),
  -- Set only for the existing-manual-Member activation path (Increment 1
  -- Members being invited to gain app access) - identity is already known,
  -- no ADR-001 resolution needed for that case.
  member_id uuid references members(id),
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  -- Email-challenge state (Auth-Handoff Security Report Section 8-9).
  -- email_challenge_hash is a keyed HMAC, never the raw 6-digit code -
  -- computed and compared entirely inside the Edge Functions holding the
  -- HMAC secret, never in SQL, so the secret never touches the database.
  email_challenge_hash text,
  email_challenge_expires_at timestamptz,
  email_challenge_attempts int not null default 0,
  email_verified_at timestamptz,
  resend_count int not null default 0,
  last_resend_at timestamptz
);

create index gym_invitations_gym_id_idx on gym_invitations (gym_id, created_at desc);
create index gym_invitations_email_idx on gym_invitations (gym_id, lower(invited_email));

-- At most one outstanding (not accepted, not revoked) invitation per
-- (gym, email) - Product Specification Section 4.2 Rule 2. The creating
-- function explicitly revokes any prior outstanding invitation before
-- inserting a new one (supersession, per Rule 2's own text); this index is
-- the concurrency safety net for two admins inviting the same email at
-- once, not the primary mechanism.
create unique index gym_invitations_one_outstanding_idx on gym_invitations (gym_id, lower(invited_email))
  where accepted_at is null and revoked_at is null;

alter table gym_invitations enable row level security;

create policy "gym_invitations_select_admin" on gym_invitations
  for select to authenticated
  using (is_admin(gym_id));

grant select on table gym_invitations to authenticated;
grant all on table gym_invitations to service_role;

comment on table gym_invitations is
  'M9 Invite Member (Product Specification Section 4.2). Invitation lifecycle and email-challenge state only - no draft profile/waiver data. Written exclusively via SECURITY DEFINER functions callable only by service_role.';

alter table gym_invitations replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gym_invitations'
  ) then
    alter publication supabase_realtime add table gym_invitations;
  end if;
end $$;
