-- M10.3 Admin Invitation - SQL functions.
--
-- All SECURITY DEFINER, callable only by service_role - EXECUTE explicitly
-- revoked from anon/authenticated BY NAME below, in this SAME migration.
-- This is safe for brand-new functions (the auto-grant/lockdown hazard
-- this project has hit twice applies to DROP+RECREATE of an EXISTING
-- function, not to first creation - the same reasoning M10.1's
-- bootstrap_owner_gym migration already used).
--
-- Reconciling two frozen documents, stated explicitly rather than silently
-- resolved: M10_IMPLEMENTATION_PLAN.md's own Edge Function boundary table
-- describes send_admin_invitation/revoke_admin_invitation as directly
-- client-callable SQL RPCs ("no external API"). But
-- OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.5 requires these
-- invitations to reuse M9's exact token shape - "random, HMAC-hashed,
-- single-use, time-limited, revocable" - and the HMAC secret
-- (INVITATION_HMAC_SECRET) exists only in Edge Function runtime
-- environment, never in Postgres, by an explicit, already-reviewed
-- security principle this project already committed to (Final Auth-
-- Handoff Security Report Section 7, quoted directly in
-- supabase/functions/_shared/invite.ts: "a database-only exposure cannot
-- be used to recover or verify guesses"). A pure SQL RPC cannot compute an
-- HMAC token itself without either weakening that security posture or
-- duplicating the secret into Postgres (rejected, for the same reason M9
-- never did it). Read narrowly, "no external API" in that boundary table
-- means no *third-party* API call (unlike, e.g., purchase_platform_plan's
-- Stripe call) - it does not, and structurally cannot, mean "no Edge
-- Function ever" once the HMAC requirement is taken into account. These
-- two RPCs are therefore service_role-only, invoked from the single new
-- Edge Function (accept-admin-invitation, handling send/revoke/accept as
-- three actions - the exact same multi-action shape already proven by
-- admin-invite-member's create/revoke/resend), never called directly by
-- an authenticated client. This is the smallest change that honors both
-- documents simultaneously; neither is redesigned.
--
-- A third RPC (accept_admin_invitation) is added beyond the two the plan
-- names explicitly, for the identical reason: every M9 write, without a
-- single exception in this codebase's history, goes through a dedicated
-- SECURITY DEFINER function, never a raw table write from an Edge
-- Function - this is not a new decision, it is the same, already fully
-- established discipline applied to the one write M10.3's own plan text
-- didn't spell out to the same level of detail as the other two.

create or replace function send_admin_invitation(
  p_gym_id uuid,
  p_actor_admin_id uuid,
  p_invited_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Supersede any prior outstanding invitation for this (gym, email) -
  -- identical rule to m9_write_invitation, restated here rather than
  -- shared, since the two tables are deliberately separate.
  update admin_invitations
  set revoked_at = now()
  where gym_id = p_gym_id and lower(invited_email) = lower(p_invited_email)
    and accepted_at is null and revoked_at is null;

  insert into admin_invitations (gym_id, invited_email, invited_by, token_hash, expires_at)
  values (p_gym_id, lower(p_invited_email), p_actor_admin_id, p_token_hash, p_expires_at)
  returning id into v_id;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, null, 'admin_invited');

  return v_id;
end;
$$;

revoke execute on function send_admin_invitation(uuid, uuid, text, text, timestamptz) from anon, authenticated;
grant execute on function send_admin_invitation(uuid, uuid, text, text, timestamptz) to service_role;

create or replace function revoke_admin_invitation(
  p_invitation_id uuid,
  p_gym_id uuid,
  p_actor_admin_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update admin_invitations
  set revoked_at = now()
  where id = p_invitation_id and gym_id = p_gym_id
    and accepted_at is null and revoked_at is null;

  if not found then
    return false;
  end if;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, null, 'admin_invitation_revoked');
  return true;
end;
$$;

revoke execute on function revoke_admin_invitation(uuid, uuid, uuid) from anon, authenticated;
grant execute on function revoke_admin_invitation(uuid, uuid, uuid) to service_role;

-- accept_admin_invitation: the sole writer of `admins` for this flow.
-- Returns a status code (mirrors the m9_final_commit_* convention exactly)
-- so the Edge Function can distinguish invalid/expired/already-accepted
-- from success without relying on a thrown exception for an expected,
-- named outcome.
create or replace function accept_admin_invitation(
  p_invitation_id uuid,
  p_new_admin_id uuid,
  p_new_admin_email text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv admin_invitations%rowtype;
begin
  select * into v_inv from admin_invitations where id = p_invitation_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    return 'invalid_invitation';
  end if;

  -- admins.id is a primary key - a genuine race (the same invitation
  -- accepted twice concurrently, or the invited identity already an Admin
  -- of this gym through some other path) surfaces here as a real
  -- constraint violation, not silently. No idempotency layer is added for
  -- this case: unlike Bootstrap (PENDING_OWNER_IMPLEMENTATION_CONTRACT.md),
  -- an Admin Invitation is accepted by a human clicking a link exactly
  -- once, and admin_invitations.accepted_at is checked immediately above
  -- for the ordinary case - this is the one edge the check above cannot
  -- fully close, named rather than silently handled.
  insert into admins (id, email, gym_id) values (p_new_admin_id, p_new_admin_email, v_inv.gym_id);

  update admin_invitations set accepted_at = now() where id = p_invitation_id;

  perform m9_write_audit_entry(v_inv.gym_id, p_new_admin_id, null, 'admin_invitation_accepted');

  return 'ok';
end;
$$;

revoke execute on function accept_admin_invitation(uuid, uuid, text) from anon, authenticated;
grant execute on function accept_admin_invitation(uuid, uuid, text) to service_role;
