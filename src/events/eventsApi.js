// FORGE EVENTS - member data access. ONLY the Phase 1 contract:
//   reads : events / event_registrations / event_attempts (RLS decides what a
//           member sees: own gym, non-draft, flag on, participants /
//           leaderboard visibility), app_settings 'events_enabled',
//           event_registration_counts, my_pending_event_announcements
//   writes: event_join / event_leave / event_ack_announcement /
//           event_submit_attempt / event_update_attempt / event_delete_attempt
// The client NEVER sends gym_id, division (except the member's own choice to
// event_join), status, format or format config - the server derives them.
// Nothing here touches classes, bookings, subscriptions, orders or payments.

import { supabase } from '../supabase'
import { resolveMemberIdentity } from '../utils'

function fail(error) {
  const err = new Error(error?.message || String(error))
  err.code = error?.code
  throw err
}

/** Feature flag: app_settings (gym_id, 'events_enabled') = 'true'. Absent row = OFF. */
export async function fetchEventsEnabled(gymId) {
  if (!gymId) return false
  const { data, error } = await supabase.from('app_settings').select('value')
    .eq('gym_id', gymId).eq('key', 'events_enabled').maybeSingle()
  if (error) fail(error)
  return data?.value === 'true'
}

export async function fetchMemberEvents(gymId) {
  const { data, error } = await supabase.from('events').select('*')
    .eq('gym_id', gymId).neq('status', 'draft')
    .order('starts_at', { ascending: true }).limit(300)
  if (error) fail(error)
  return data || []
}

export async function fetchEvent(gymId, eventId) {
  const { data, error } = await supabase.from('events').select('*')
    .eq('gym_id', gymId).eq('id', eventId).neq('status', 'draft').maybeSingle()
  if (error) fail(error)
  return data || null
}

export async function fetchMyRegistrations(gymId, memberId) {
  const { data, error } = await supabase.from('event_registrations')
    .select('event_id, member_id, division, status, registered_at, withdrawn_at')
    .eq('gym_id', gymId).eq('member_id', memberId)
  if (error) fail(error)
  return data || []
}

export async function fetchRegistrationCounts(eventIds) {
  const out = {}
  if (!eventIds?.length) return out
  const { data, error } = await supabase.rpc('event_registration_counts', { p_event_ids: eventIds })
  if (error) fail(error)
  for (const r of data || []) out[r.event_id] = r.registered_count
  return out
}

/** Registered participants the member may see (RLS: own row always; others only when participants_visible). */
export async function fetchParticipants(gymId, eventId) {
  const { data, error } = await supabase.from('event_registrations')
    .select('member_id, division, status, registered_at')
    .eq('gym_id', gymId).eq('event_id', eventId).eq('status', 'registered')
    .order('registered_at', { ascending: true })
  if (error) fail(error)
  return data || []
}

/** Attempts the member may see (RLS: own incl. deleted; others' non-deleted when the leaderboard is visible). */
export async function fetchAttempts(gymId, eventId) {
  const { data, error } = await supabase.from('event_attempts').select('*')
    .eq('gym_id', gymId).eq('event_id', eventId)
    .order('created_at', { ascending: true }).limit(5000)
  if (error) fail(error)
  return data || []
}

/**
 * Member display identity, exactly like fetchClasament (App.jsx): name/avatar
 * members-first with profiles fallback (resolveMemberIdentity), gender from
 * members only, weight_unit profiles-first.
 */
export async function fetchMembersByIds(ids) {
  const out = {}
  const uniq = [...new Set((ids || []).filter(Boolean))]
  if (!uniq.length) return out
  const [{ data: profiles, error: pErr }, { data: members, error: mErr }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, avatar_url, weight_unit').in('id', uniq),
    supabase.from('members').select('id, full_name, email, avatar_url, weight_unit, gender').in('id', uniq),
  ])
  if (pErr) fail(pErr)
  if (mErr) fail(mErr)
  const prof = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  const mem = Object.fromEntries((members || []).map((m) => [m.id, m]))
  for (const id of uniq) {
    if (!prof[id] && !mem[id]) continue
    out[id] = {
      id,
      ...resolveMemberIdentity(mem[id], prof[id]),
      gender: mem[id]?.gender ?? null,
      weight_unit: prof[id]?.weight_unit ?? mem[id]?.weight_unit ?? null,
    }
  }
  return out
}

export async function joinEvent(eventId, division) {
  const { data, error } = await supabase.rpc('event_join', { p_event_id: eventId, p_division: division ?? null })
  if (error) fail(error)
  return data
}

export async function leaveEvent(eventId) {
  const { data, error } = await supabase.rpc('event_leave', { p_event_id: eventId })
  if (error) fail(error)
  return data
}

export async function fetchPendingAnnouncements() {
  const { data, error } = await supabase.rpc('my_pending_event_announcements')
  if (error) fail(error)
  return data || []
}

export async function ackAnnouncement(eventId, revision, action) {
  const { data, error } = await supabase.rpc('event_ack_announcement', { p_event_id: eventId, p_revision: revision, p_action: action })
  if (error) fail(error)
  return data
}

export async function submitAttempt(eventId, clientAttemptId, fields) {
  const { data, error } = await supabase.rpc('event_submit_attempt', { p_event_id: eventId, p_client_attempt_id: clientAttemptId, p_fields: fields })
  if (error) fail(error)
  return data
}

export async function updateAttempt(attemptId, fields) {
  const { data, error } = await supabase.rpc('event_update_attempt', { p_attempt_id: attemptId, p_fields: fields })
  if (error) fail(error)
  return data
}

export async function deleteAttempt(attemptId) {
  const { data, error } = await supabase.rpc('event_delete_attempt', { p_attempt_id: attemptId })
  if (error) fail(error)
  return data
}

export function coverUrl(path) {
  if (!path) return null
  return supabase.storage.from('event-covers').getPublicUrl(path).data.publicUrl
}
