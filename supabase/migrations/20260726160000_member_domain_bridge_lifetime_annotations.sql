-- M1.4.1 / M1.4.1b - Explicit lifetime documentation
--
-- Attaches COMMENT ON metadata directly to the live database objects,
-- not just to migration source text, so the constraint travels with
-- the schema itself (matching this repository's own existing
-- precedent - see notify_visibility_change()'s comment). Purely
-- documentary: no behaviour, no schema, no data change.
--
-- The point being recorded: every object below is a bridge that exists
-- only because `profiles` is currently the Member Domain Source of
-- Truth. Each one treats `profiles` as authoritative and
-- members/memberships as the thing being kept in sync with it, or
-- verified against it. That is only a correct model for as long as
-- `profiles` remains the Source of Truth. It is not a design that
-- extends naturally to the moment Member Domain itself becomes
-- authoritative - at that point the direction of truth reverses, and
-- every object here must be redesigned or replaced, not merely kept
-- running or extended in place.

comment on function sync_member_from_profile(profiles) is
  'M1.4.1 bridge. Mirrors one profiles row into members. Valid only while profiles is the Member Domain Source of Truth - must be redesigned or retired before Member Domain becomes authoritative (full cutover), not merely extended.';

comment on function member_domain_sync_on_profile_insert() is
  'M1.4.1 bridge trigger function (profiles -> members/memberships, one direction only). Valid only while profiles is the Member Domain Source of Truth - must be redesigned or retired before Member Domain becomes authoritative, not merely extended.';

comment on function member_domain_sync_on_profile_gym_change() is
  'M1.4.1 bridge trigger function (profiles.gym_id -> memberships, one direction only). Valid only while profiles is the Member Domain Source of Truth - must be redesigned or retired before Member Domain becomes authoritative, not merely extended.';

comment on view member_domain_consistency_detail is
  'M1.4.1b bridge. Every check here treats profiles as authoritative and members/memberships as the thing being verified against it. Valid only while profiles is the Member Domain Source of Truth - this framework must be redesigned or replaced, not merely extended, before the full cutover to Member Domain, at which point "consistent with profiles" stops being the correct question to ask.';

comment on function member_domain_consistency_report() is
  'M1.4.1b bridge. See comment on member_domain_consistency_detail - valid only while profiles is the Member Domain Source of Truth.';

comment on function member_domain_consistency_summary() is
  'M1.4.1b bridge. See comment on member_domain_consistency_detail - valid only while profiles is the Member Domain Source of Truth.';

comment on function reconcile_member_domain(boolean) is
  'M1.4.1b bridge. Repairs members/memberships toward profiles as the assumed-authoritative source. Valid only while profiles is the Member Domain Source of Truth - must be redesigned or replaced, not merely extended, before the full cutover to Member Domain, at which point repairing "toward profiles" is no longer the correct direction.';
