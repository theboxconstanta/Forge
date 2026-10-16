/* global process */
// TEST-ONLY adapter: the member `api` surface of ../eventsApi.js, executed as
// real SQL against the DISPOSABLE local Postgres container created by
// supabase/tests/forge-events/pg/setup.sh (127.0.0.1 only, no Supabase
// project). Every call runs as role `authenticated` with the member's JWT
// claims, exactly how PostgREST runs it - so RLS, grants and the RPCs are the
// real ones. Only the HTTP layer (supabase-js/PostgREST) is not exercised.
import { execFileSync } from 'node:child_process'

export const CONTAINER = process.env.FORGE_EVENTS_PG_CONTAINER || 'forge-events-pg1b'

const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const json = (v) => `$json$${JSON.stringify(v)}$json$::jsonb`

export function psql(sql, { uid = null, role = 'postgres' } = {}) {
  const prefix = role === 'postgres' ? '' : [
    `set role ${role};`,
    uid ? `set request.jwt.claim.sub = '${uid}';` : '',
    uid ? `set request.jwt.claims = '{"sub":"${uid}","role":"${role}"}';` : '',
  ].join(' ')
  try {
    return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
      input: `${prefix}\n${sql}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch (e) {
    const msg = String(e.stderr || e.message).replace(/^psql:[^:]*:\d+: /m, '').trim()
    throw new Error(msg, { cause: e })
  }
}

const rows = (out) => (out ? JSON.parse(out) : [])

/** The member api, bound to one authenticated member id. */
export function memberApi(uid) {
  const asMember = (sql) => psql(sql, { uid, role: 'authenticated' })
  const select = (sql) => rows(asMember(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`))
  return {
    async fetchEventsEnabled(gymId) {
      return select(`select value from app_settings where gym_id = ${lit(gymId)} and key = 'events_enabled'`)[0]?.value === 'true'
    },
    async fetchMemberEvents(gymId) {
      return select(`select * from events where gym_id = ${lit(gymId)} and status <> 'draft' order by starts_at`)
    },
    async fetchEvent(gymId, id) {
      return select(`select * from events where gym_id = ${lit(gymId)} and id = ${lit(id)} and status <> 'draft'`)[0] || null
    },
    async fetchMyRegistrations(gymId, memberId) {
      return select(`select event_id, member_id, division, status, registered_at, withdrawn_at from event_registrations where gym_id = ${lit(gymId)} and member_id = ${lit(memberId)}`)
    },
    async fetchRegistrationCounts(ids) {
      if (!ids.length) return {}
      const r = select(`select * from event_registration_counts(array[${ids.map(lit).join(',')}]::uuid[])`)
      return Object.fromEntries(r.map((x) => [x.event_id, x.registered_count]))
    },
    async fetchParticipants(gymId, eventId) {
      return select(`select member_id, division, status, registered_at from event_registrations where gym_id = ${lit(gymId)} and event_id = ${lit(eventId)} and status = 'registered' order by registered_at`)
    },
    async fetchAttempts(gymId, eventId) {
      return select(`select * from event_attempts where gym_id = ${lit(gymId)} and event_id = ${lit(eventId)} order by created_at`)
    },
    async fetchMembersByIds(ids) {
      const uniq = [...new Set(ids)]
      if (!uniq.length) return {}
      const r = select(`select m.id, m.full_name, m.gender, p.email, null::text as avatar_url, m.weight_unit from members m left join profiles p on p.id = m.id where m.id = any(array[${uniq.map(lit).join(',')}]::uuid[])`)
      return Object.fromEntries(r.map((m) => [m.id, m]))
    },
    async joinEvent(eventId, division) {
      return JSON.parse(asMember(`select event_join(${lit(eventId)}, ${lit(division)});`))
    },
    async leaveEvent(eventId) {
      return JSON.parse(asMember(`select event_leave(${lit(eventId)});`))
    },
    async fetchPendingAnnouncements() {
      return select('select * from my_pending_event_announcements()')
    },
    async ackAnnouncement(eventId, revision, action) {
      return JSON.parse(asMember(`select event_ack_announcement(${lit(eventId)}, ${Number(revision)}, ${lit(action)});`))
    },
    async submitAttempt(eventId, clientAttemptId, fields) {
      return JSON.parse(asMember(`select to_json(event_submit_attempt(${lit(eventId)}, ${lit(clientAttemptId)}, ${json(fields)}));`))
    },
    async updateAttempt(attemptId, fields) {
      return JSON.parse(asMember(`select to_json(event_update_attempt(${lit(attemptId)}, ${json(fields)}));`))
    },
    async deleteAttempt(attemptId) {
      return JSON.parse(asMember(`select event_delete_attempt(${lit(attemptId)});`))
    },
    coverUrl: (p) => (p ? `https://covers.local/${p}` : null),
  }
}

/** Staff actions exactly as the Admin Events client issues them (column-granted insert + lifecycle RPC). */
export function staffApi(uid) {
  const asStaff = (sql) => psql(sql, { uid, role: 'authenticated' })
  return {
    createEvent(gymId, payload) {
      const cols = ['gym_id', ...Object.keys(payload)]
      const vals = [lit(gymId), ...Object.values(payload).map((v) => (Array.isArray(v) ? `array[${v.map(lit).join(',')}]` : v !== null && typeof v === 'object' ? json(v) : typeof v === 'boolean' || typeof v === 'number' ? String(v) : lit(v)))]
      return JSON.parse(asStaff(`with ins as (insert into events (${cols.join(', ')}) values (${vals.join(', ')}) returning *) select row_to_json(ins) from ins;`))
    },
    publishEvent(eventId) {
      return JSON.parse(asStaff(`select event_publish(${lit(eventId)});`))
    },
    attemptsAsStaff(eventId) {
      return rows(asStaff(`select coalesce(json_agg(t), '[]'::json) from (select * from event_attempts where event_id = ${lit(eventId)}) t;`))
    },
  }
}

/**
 * Test isolation: wipes ONLY Events data (and re-enables the flag) so every
 * run starts from the same state, regardless of announcements / attempts left
 * by earlier runs. Refuses unless the database carries the marker table that
 * only supabase/tests/forge-events/pg/02_seed.sql creates - it can never touch
 * any other database.
 */
export function resetEventsData() {
  psql(`do $guard$ begin
      if to_regclass('public.forge_test_disposable_marker') is null then
        raise exception 'refusing to reset: not the disposable FORGE Events test database';
      end if;
    end $guard$;
    delete from event_attempt_history;
    delete from event_attempts;
    delete from event_announcement_acks;
    delete from event_registrations;
    delete from events;
    update app_settings set value = 'true' where key = 'events_enabled';`)
}
