// FORGE EVENTS Phase 1 - executes the REAL migration (and its rollback)
// against an isolated in-memory Postgres (PGlite) seeded with fixture.sql,
// which mirrors the live shapes. No network, no Supabase project, no
// production data.
//
// PGlite is deliberately NOT a project dependency. Run from a scratch dir
// that has it installed:
//   npm i @electric-sql/pglite@0.2.17
//   node run.mjs <migration.sql> <rollback.sql>   (copy this folder there)
//
// Not covered here: truly parallel sessions (PGlite is single-connection).
// Join / submit serialization relies on SELECT ... FOR UPDATE of the event
// row; that is exercised on real Postgres by pg/run-pg.sh (Phase 1B, D15).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const migrationPath = process.argv[2] || here('../../migrations/20261014120000_forge_events_phase1.sql')
const rollbackPath = process.argv[3] || here('../../rollbacks/20261014120000_forge_events_phase1.rollback.sql')
const fixture = readFileSync(new URL('./fixture.sql', import.meta.url), 'utf8')
const migration = readFileSync(migrationPath, 'utf8')
const rollback = readFileSync(rollbackPath, 'utf8')

const G1 = '11111111-1111-1111-1111-111111111111'
const G2 = '22222222-2222-2222-2222-222222222222'
const U = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), COACH = U(2), MEMBER = U(3), EXPIRED = U(4), NOSUB = U(5), M6 = U(6), M7 = U(7)
const ADMIN_G2 = U(10), MEMBER_G2 = U(11), NO_GYM = U(12)

const db = new PGlite()
let passed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS', name) }
  else { failures.push(name); console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : '') }
}
const section = (s) => console.log(`\n[${s}]`)
async function q(sql, params) { return (await db.query(sql, params)).rows }
async function as(uid, sql, params, role = 'authenticated') {
  await db.exec(`set role ${role}; select set_config('test.uid', '${uid || ''}', false);`)
  try { return { rows: (await db.query(sql, params)).rows } }
  catch (e) { return { error: e.message } }
  finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}
const errIs = (r, msg) => !!r.error && r.error.includes(msg)
const fp = async (table) => (await q(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from ${table} t`))[0].h

// ---------- seed ----------
await db.exec(fixture)
await db.exec(`
  insert into gyms values ('${G1}', 'C15'), ('${G2}', 'Other');
  insert into auth.users select unnest(array['${ADMIN}','${COACH}','${MEMBER}','${EXPIRED}','${NOSUB}','${M6}','${M7}','${ADMIN_G2}','${MEMBER_G2}','${NO_GYM}']::uuid[]);
  insert into admins values ('${ADMIN}', '${G1}'), ('${ADMIN_G2}', '${G2}');
  insert into coaches values ('${COACH}', '${G1}');
  insert into profiles (id, gym_id, email) values
    ('${ADMIN}', '${G1}', 'admin@x'), ('${COACH}', '${G1}', 'coach@x'), ('${MEMBER}', '${G1}', 'member@x'),
    ('${EXPIRED}', '${G1}', 'expired@x'), ('${NOSUB}', '${G1}', 'nosub@x'), ('${M6}', '${G1}', 'm6@x'), ('${M7}', '${G1}', 'm7@x'),
    ('${ADMIN_G2}', '${G2}', 'admin2@x'), ('${MEMBER_G2}', '${G2}', 'member2@x'), ('${NO_GYM}', null, 'nogym@x');
  insert into memberships (member_id, gym_id, status) select id, gym_id, 'active' from profiles where gym_id is not null;
  insert into subscriptions (gym_id, member_email, is_active, start_date, end_date, sessions_total, sessions_used) values
    ('${G1}', 'member@x', true, current_date - 10, current_date + 20, 12, 3),
    ('${G1}', 'expired@x', true, current_date - 60, current_date - 30, 12, 12);
  insert into classes (gym_id, name, date, max_spots) values ('${G1}', 'CrossFit', current_date + 1, 12);
  insert into bookings (gym_id, member_id, class_id) select '${G1}', '${MEMBER}', id::text from classes;
  insert into app_settings (gym_id, key, value) values ('${G1}', 'online_payments_enabled', 'true');
`)
const baseline = {
  classes: await fp('classes'), bookings: await fp('bookings'), subscriptions: await fp('subscriptions'),
  memberships: await fp('memberships'), profiles: await fp('profiles'),
}
const fnsBefore = (await q(`select string_agg(proname, ',' order by proname) s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`))[0].s
const pubBefore = (await q(`select string_agg(tablename, ',' order by tablename) s from pg_publication_tables where pubname = 'supabase_realtime'`))[0].s

// ---------- migration ----------
section('migration')
let migErr = null
try { await db.exec(migration) } catch (e) { migErr = e.message }
check('migration applies cleanly on the live-shaped fixture', !migErr, migErr)
if (migErr) { console.log(`\n${passed} passed, ${failures.length + 1} failed`); process.exit(1) }

// ---------- static privilege review ----------
section('static privilege review')
const newFns = await q(`
  select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg,
         has_function_privilege('anon', p.oid, 'execute') anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') auth_x,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') public_x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'event%' or p.proname like 'forge_events%' or p.proname = 'my_pending_event_announcements')`)
check('every SECURITY DEFINER function pins search_path', newFns.filter(f => f.prosecdef).every(f => f.cfg.includes('search_path=public')), newFns.filter(f => f.prosecdef && !f.cfg.includes('search_path')).map(f => f.proname))
check('no new function is executable by anon', newFns.every(f => !f.anon_x), newFns.filter(f => f.anon_x).map(f => f.proname))
check('no new function is executable by PUBLIC', newFns.every(f => !f.public_x), newFns.filter(f => f.public_x).map(f => f.proname))
const internal = ['forge_events_member_event', 'forge_events_staff_event', 'forge_events_own_open_attempt', 'forge_events_clean_score', 'events_edit_guard', 'event_attempts_record_history', 'event_attempt_history_immutable', 'forge_events_touch_updated_at']
check('internal helpers are not callable by authenticated', newFns.filter(f => internal.includes(f.proname)).every(f => !f.auth_x), newFns.filter(f => internal.includes(f.proname) && f.auth_x).map(f => f.proname))
const publicRpcs = ['event_publish', 'event_cancel', 'event_archive', 'event_join', 'event_leave', 'event_registration_counts', 'event_ack_announcement', 'my_pending_event_announcements', 'event_submit_attempt', 'event_update_attempt', 'event_delete_attempt', 'forge_events_enabled']
check('the 12 client-facing functions are callable by authenticated', publicRpcs.every(n => newFns.find(f => f.proname === n)?.auth_x), publicRpcs.filter(n => !newFns.find(f => f.proname === n)?.auth_x))
check('my_pending_event_announcements is SECURITY INVOKER (RLS decides)', newFns.find(f => f.proname === 'my_pending_event_announcements')?.prosecdef === false)
const tables = ['events', 'event_registrations', 'event_announcement_acks', 'event_attempts', 'event_attempt_history']
const tgrants = await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated', 'PUBLIC')`, [tables])
check('anon / PUBLIC hold no privilege on any Events table', tgrants.every(g => g.grantee === 'authenticated'), tgrants.filter(g => g.grantee !== 'authenticated'))
check('authenticated: table-level SELECT only (+ DELETE on events)', tgrants.every(g => g.privilege_type === 'SELECT' || (g.table_name === 'events' && g.privilege_type === 'DELETE')), tgrants.filter(g => g.privilege_type !== 'SELECT'))
const colGrants = await q(`select distinct column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'events' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')`)
const lifecycleCols = ['status', 'published_at', 'cancelled_at', 'archived_at', 'announcement_revision', 'created_by', 'created_at', 'updated_at', 'id']
check('lifecycle columns are never insertable/updatable by clients', !colGrants.some(c => lifecycleCols.includes(c.column_name)), colGrants.filter(c => lifecycleCols.includes(c.column_name)))
check('gym_id is insertable but never updatable', colGrants.some(c => c.column_name === 'gym_id' && c.privilege_type === 'INSERT') && !colGrants.some(c => c.column_name === 'gym_id' && c.privilege_type === 'UPDATE'))
const otherWrites = await q(`select distinct table_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = any($1) and table_name <> 'events' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')`, [tables])
check('no client INSERT/UPDATE on registrations, acks, attempts, history', otherWrites.length === 0, otherWrites)
const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1)`, [tables])
check('RLS enabled on all 5 Events tables', rls.length === 5 && rls.every(r => r.relrowsecurity))
const pub = (await q(`select string_agg(tablename, ',' order by tablename) s from pg_publication_tables where pubname = 'supabase_realtime'`))[0].s
check('realtime publication gains exactly events, event_registrations, event_attempts', pub === 'app_settings,bookings,classes,event_attempts,event_registrations,events', pub)
const bucket = (await q(`select * from storage.buckets where id = 'event-covers'`))[0]
check('event-covers bucket: public, 5 MB, jpeg/webp only', bucket?.public === true && Number(bucket.file_size_limit) === 5242880 && bucket.allowed_mime_types.join(',') === 'image/jpeg,image/webp')
check('existing buckets untouched', (await q(`select count(*)::int n from storage.buckets where id in ('avatars', 'wod-photos')`))[0].n === 2)

// ---------- creating events ----------
section('staff authoring, roles and drafts')
const insertEvent = (uid, cols) => as(uid, `insert into events (${Object.keys(cols).join(', ')}) values (${Object.keys(cols).map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, Object.values(cols))
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString()
const SOCIAL = (await insertEvent(ADMIN, { gym_id: G1, event_type: 'Social', title: 'Halloween Party', starts_at: inDays(3), capacity: 2 })).rows?.[0]?.id
check('admin creates a draft through the granted columns', !!SOCIAL)
const MOTM = (await insertEvent(COACH, { gym_id: G1, event_type: 'Mission of the Month', title: 'October Mission', starts_at: inDays(-1), ends_at: inDays(10), has_workout: true, workout_format: 'For Time', workout_format_config: JSON.stringify({}), scoring_enabled: true })).rows?.[0]?.id
check('coach creates a scoring draft (D2: coaches + admins)', !!MOTM)
check('member cannot create events', errIs(await insertEvent(MEMBER, { gym_id: G1, event_type: 'x', title: 'x', starts_at: inDays(1) }), 'row-level security'))
check('admin cannot create an event in another gym', errIs(await insertEvent(ADMIN, { gym_id: G2, event_type: 'x', title: 'x', starts_at: inDays(1) }), 'row-level security'))
check('client cannot insert status directly', errIs(await insertEvent(ADMIN, { gym_id: G1, event_type: 'x', title: 'x', starts_at: inDays(1), status: 'published' }), 'permission denied'))
check('cover_path must live in the event gym folder', errIs(await insertEvent(ADMIN, { gym_id: G1, event_type: 'x', title: 'x', starts_at: inDays(1), cover_path: `${G2}/e/x.jpg` }), 'check constraint'))
check('scoring is limited to v1 formats (EMOM rejected)', errIs(await insertEvent(ADMIN, { gym_id: G1, event_type: 'x', title: 'x', starts_at: inDays(-1), ends_at: inDays(5), has_workout: true, workout_format: 'EMOM', scoring_enabled: true }), 'check constraint'))
check('scoring requires an end date', errIs(await insertEvent(ADMIN, { gym_id: G1, event_type: 'x', title: 'x', starts_at: inDays(1), has_workout: true, workout_format: 'AMRAP', scoring_enabled: true }), 'check constraint'))
check('member cannot see drafts', (await as(MEMBER, 'select id from events')).rows.length === 0)
check('coach sees drafts of own gym', (await as(COACH, 'select id from events')).rows.length === 2)
check('other-gym admin cannot see the drafts', (await as(ADMIN_G2, 'select id from events')).rows.length === 0)
check('staff cannot update status directly (column grant)', errIs(await as(ADMIN, `update events set status = 'published' where id = $1`, [SOCIAL]), 'permission denied'))
check('staff cannot update announcement_revision directly', errIs(await as(ADMIN, `update events set announcement_revision = 5 where id = $1`, [SOCIAL]), 'permission denied'))
check('member cannot publish', errIs(await as(MEMBER, 'select event_publish($1)', [SOCIAL]), 'event_not_found'))
check('other-gym admin cannot publish', errIs(await as(ADMIN_G2, 'select event_publish($1)', [SOCIAL]), 'event_not_found'))
check('anon cannot call any RPC', errIs(await as(null, 'select event_publish($1)', [SOCIAL], 'anon'), 'permission denied') && errIs(await as(null, 'select my_pending_event_announcements()', [], 'anon'), 'permission denied'))
check('anon cannot read events', errIs(await as(null, 'select * from events', [], 'anon'), 'permission denied'))

// ---------- lifecycle ----------
section('publication lifecycle')
const pubS = await as(ADMIN, 'select event_publish($1) r', [SOCIAL])
check('publish draft -> published, revision 1', pubS.rows?.[0]?.r?.announcement_revision === 1, pubS)
check('publishing twice is rejected', errIs(await as(ADMIN, 'select event_publish($1)', [SOCIAL]), 'invalid_transition'))
check('coach publishes the Mission', (await as(COACH, 'select event_publish($1) r', [MOTM])).rows?.[0]?.r?.status === 'published')
const PAST = (await insertEvent(ADMIN, { gym_id: G1, event_type: 'x', title: 'Old', starts_at: inDays(-3), ends_at: inDays(-2) })).rows[0].id
check('an already-ended event cannot be published', errIs(await as(ADMIN, 'select event_publish($1)', [PAST]), 'event_already_ended'))
check('published event cannot be deleted (policy filters it)', (await as(ADMIN, 'delete from events where id = $1 returning id', [SOCIAL])).rows?.length === 0 && (await q('select 1 from events where id = $1', [SOCIAL])).length === 1)
check('draft can be deleted by staff', (await as(ADMIN, 'delete from events where id = $1 returning id', [PAST])).rows?.length === 1)
check('archive of a running published event is rejected', errIs(await as(ADMIN, 'select event_archive($1)', [SOCIAL]), 'invalid_transition'))

// ---------- feature flag ----------
section('feature flag (app_settings events_enabled)')
check('flag absent: member sees no published events', (await as(MEMBER, 'select id from events')).rows.length === 0)
check('flag absent: join -> event_not_found', errIs(await as(MEMBER, 'select event_join($1)', [SOCIAL]), 'event_not_found'))
check('flag absent: no pending announcements', (await as(MEMBER, 'select * from my_pending_event_announcements()')).rows.length === 0)
check('flag absent: staff still see their events', (await as(COACH, 'select id from events')).rows.length === 2)
check('member cannot switch the flag on', errIs(await as(MEMBER, `insert into app_settings (gym_id, key, value) values ($1, 'events_enabled', 'true')`, [G1]), 'row-level security'))
check('coach cannot switch the flag on (admin-only, live policy)', errIs(await as(COACH, `insert into app_settings (gym_id, key, value) values ($1, 'events_enabled', 'true')`, [G1]), 'row-level security'))
check('other-gym admin cannot switch this gym on', errIs(await as(ADMIN_G2, `insert into app_settings (gym_id, key, value) values ($1, 'events_enabled', 'true')`, [G1]), 'row-level security'))
await as(ADMIN, `insert into app_settings (gym_id, key, value) values ($1, 'events_enabled', 'false')`, [G1])
check("flag 'false' still OFF", (await as(MEMBER, 'select id from events')).rows.length === 0)
check('gym admin switches the flag on', !(await as(ADMIN, `update app_settings set value = 'true' where gym_id = $1 and key = 'events_enabled'`, [G1])).error)
check('flag on: member sees the 2 published events', (await as(MEMBER, 'select id from events')).rows.length === 2)
check('flag is per gym: gym 2 member sees nothing', (await as(MEMBER_G2, 'select id from events')).rows.length === 0)
check('member with no gym sees nothing', (await as(NO_GYM, 'select id from events')).rows.length === 0)

// ---------- announcements ----------
section('announcements')
let pend = (await as(MEMBER, 'select id, announcement_revision from my_pending_event_announcements()')).rows
check('both published events pending, oldest publication first', pend.length === 2 && pend[0].id === SOCIAL && pend[1].id === MOTM, pend)
check('expired-subscription member gets them too', (await as(EXPIRED, 'select id from my_pending_event_announcements()')).rows.length === 2)
check('no-subscription member gets them too', (await as(NOSUB, 'select id from my_pending_event_announcements()')).rows.length === 2)
check('other gym member gets none', (await as(MEMBER_G2, 'select id from my_pending_event_announcements()')).rows.length === 0)
check('ack revision above current rejected', errIs(await as(MEMBER, 'select event_ack_announcement($1, 2, $2)', [SOCIAL, 'dismissed']), 'invalid_revision'))
check('ack revision 0 rejected', errIs(await as(MEMBER, 'select event_ack_announcement($1, 0, $2)', [SOCIAL, 'dismissed']), 'invalid_revision'))
check('ack with an unknown action rejected', errIs(await as(MEMBER, 'select event_ack_announcement($1, 1, $2)', [SOCIAL, 'spam']), 'invalid_action'))
check('MAYBE LATER acknowledges server-side', !(await as(MEMBER, 'select event_ack_announcement($1, 1, $2)', [SOCIAL, 'dismissed'])).error)
pend = (await as(MEMBER, 'select id from my_pending_event_announcements()')).rows
check('acknowledged announcement no longer pending; the next one is', pend.length === 1 && pend[0].id === MOTM)
check('acking only affects the caller (another member still pending)', (await as(EXPIRED, 'select id from my_pending_event_announcements()')).rows.length === 2)
check('member cannot insert an ack row directly', errIs(await as(MEMBER, `insert into event_announcement_acks values ($1, $2, $3, 1, 'dismissed', now())`, [SOCIAL, G1, EXPIRED]), 'permission denied'))
check('member sees only own acks', (await as(EXPIRED, 'select * from event_announcement_acks')).rows.length === 0)
check('other gym member cannot ack this gym event', errIs(await as(MEMBER_G2, 'select event_ack_announcement($1, 1, $2)', [SOCIAL, 'dismissed']), 'event_not_found'))

// ---------- registration ----------
section('registration, capacity, expired memberships')
const join = (uid, ev, div) => as(uid, 'select event_join($1, $2) r', [ev, div ?? null])
const j1 = await join(MEMBER, SOCIAL)
check('member joins (capacity 2)', j1.rows?.[0]?.r?.status === 'registered', j1)
check('JOIN from the modal + ack joined', !(await as(EXPIRED, 'select event_ack_announcement($1, 1, $2)', [SOCIAL, 'joined'])).error && (await join(EXPIRED, SOCIAL)).rows?.[0]?.r?.status === 'registered')
check('joining twice changes nothing (idempotent)', (await join(MEMBER, SOCIAL)).rows?.[0]?.r?.changed === false && (await q('select count(*)::int n from event_registrations where event_id = $1 and member_id = $2', [SOCIAL, MEMBER]))[0].n === 1)
check('capacity full -> event_full', errIs(await join(NOSUB, SOCIAL), 'event_full'))
check('invalid division rejected', errIs(await join(NOSUB, MOTM, 'elite'), 'invalid_division'))
check('other gym member cannot join', errIs(await join(MEMBER_G2, SOCIAL), 'event_not_found'))
const lv = await as(MEMBER, 'select event_leave($1) r', [SOCIAL])
check('member leaves before the start', lv.rows?.[0]?.r?.status === 'withdrawn', lv)
check('freed spot can be taken (no-subscription member joins)', (await join(NOSUB, SOCIAL)).rows?.[0]?.r?.status === 'registered')
check('full again', errIs(await join(MEMBER, SOCIAL), 'event_full'))
await as(NOSUB, 'select event_leave($1)', [SOCIAL])
check('rejoin reactivates the same row (no duplicate)', (await join(MEMBER, SOCIAL)).rows?.[0]?.r?.changed === true && (await q('select count(*)::int n from event_registrations where event_id = $1 and member_id = $2', [SOCIAL, MEMBER]))[0].n === 1)
check('participants visible to gym members', (await as(NOSUB, `select member_id from event_registrations where event_id = $1 and status = 'registered'`, [SOCIAL])).rows.length === 2)
check('withdrawn rows of others are not listed', (await as(M6, `select member_id from event_registrations where event_id = $1 and status = 'withdrawn'`, [SOCIAL])).rows.length === 0)
await as(ADMIN, 'update events set participants_visible = false where id = $1', [SOCIAL])
check('participants hidden -> member sees only own row', (await as(MEMBER, 'select member_id from event_registrations where event_id = $1', [SOCIAL])).rows.length === 1)
check('participants hidden -> staff still see all', (await as(COACH, 'select member_id from event_registrations where event_id = $1', [SOCIAL])).rows.length >= 2)
const counts = await as(M6, 'select * from event_registration_counts($1)', [[SOCIAL, MOTM]])
check('counts RPC returns numbers even when the list is hidden', counts.rows?.find(r => r.event_id === SOCIAL)?.registered_count === 2, counts)
check('counts RPC never leaks another gym', (await as(MEMBER_G2, 'select * from event_registration_counts($1)', [[SOCIAL]])).rows.length === 0)
check('member cannot write registrations directly', errIs(await as(MEMBER, `update event_registrations set status = 'registered' where event_id = $1`, [SOCIAL]), 'permission denied'))
// deadline / start passing (simulated by the test superuser; no attempts exist)
await q(`update events set registration_deadline = now() - interval '1 hour', starts_at = now() + interval '2 days' where id = $1`, [SOCIAL])
check('after the registration deadline -> registration_closed', errIs(await join(M6, SOCIAL), 'registration_closed'))
await q(`update events set registration_deadline = null, starts_at = now() - interval '1 hour', ends_at = now() + interval '3 hours' where id = $1`, [SOCIAL])
check('leaving after a one-off event started -> event_started', errIs(await as(MEMBER, 'select event_leave($1)', [SOCIAL]), 'event_started'))

// ---------- attempts ----------
section('Mission of the Month attempts')
const submit = (uid, ev, cid, fields) => as(uid, 'select (event_submit_attempt($1, $2, $3)).*', [ev, cid, JSON.stringify(fields)])
const cid = (n) => `cccccccc-0000-0000-0000-${String(n).padStart(12, '0')}`
check('not registered -> not_registered', errIs(await submit(MEMBER, MOTM, cid(1), { time_result: '10:00', completion_state: 'completed' }), 'not_registered'))
check('expired-subscription member joins the Mission (Scaled)', (await join(EXPIRED, MOTM, 'beginner')).rows?.[0]?.r?.division === 'beginner')
check('member joins the Mission (RX default)', (await join(MEMBER, MOTM)).rows?.[0]?.r?.division === 'rx')
const a1 = await submit(MEMBER, MOTM, cid(1), { time_result: '10:00', completion_state: 'completed' })
check('first attempt saved with division + format frozen server-side', a1.rows?.[0]?.division === 'rx' && a1.rows?.[0]?.format_snapshot === 'For Time', a1)
const retry = await submit(MEMBER, MOTM, cid(1), { time_result: '07:00', completion_state: 'completed' })
check('retry with the same client_attempt_id returns the original (no change)', retry.rows?.[0]?.id === a1.rows[0].id && retry.rows[0].time_result === '10:00')
check('retry did not create a row', (await q('select count(*)::int n from event_attempts where member_id = $1', [MEMBER]))[0].n === 1)
check('second and third attempts are kept', !(await submit(MEMBER, MOTM, cid(2), { time_result: '09:30', completion_state: 'completed' })).error && !(await submit(MEMBER, MOTM, cid(3), { result: '120', completion_state: 'capped' })).error && (await q('select count(*)::int n from event_attempts where member_id = $1', [MEMBER]))[0].n === 3)
check('client cannot choose the division', errIs(await submit(MEMBER, MOTM, cid(4), { time_result: '9:00', division: 'beginner' }), 'invalid_fields'))
check('client cannot choose the format', errIs(await submit(MEMBER, MOTM, cid(4), { time_result: '9:00', format_snapshot: 'AMRAP' }), 'invalid_fields'))
check('empty score rejected', errIs(await submit(MEMBER, MOTM, cid(4), { notes: 'felt good' }), 'empty_score'))
check('bad completion_state rejected', errIs(await submit(MEMBER, MOTM, cid(4), { time_result: '9:00', completion_state: 'finished' }), 'invalid_fields'))
check('bad weight unit rejected', errIs(await submit(MEMBER, MOTM, cid(4), { result: '100', weight_unit: 'stone' }), 'invalid_fields'))
check('expired-subscription member submits', !(await submit(EXPIRED, MOTM, cid(50), { time_result: '12:00', completion_state: 'completed' })).error)
check('division switch after attempts -> division_locked', errIs(await join(MEMBER, MOTM, 'beginner'), 'division_locked'))
check('leaving after attempts -> leave_locked_attempts_exist', errIs(await as(MEMBER, 'select event_leave($1)', [MOTM]), 'leave_locked_attempts_exist'))
check('member cannot insert attempts directly', errIs(await as(MEMBER, `insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, time_result, format_snapshot) values ($1, $2, $3, gen_random_uuid(), 'rx', '1:00', 'For Time')`, [MOTM, G1, MEMBER]), 'permission denied'))
check('member cannot update attempts directly', errIs(await as(MEMBER, `update event_attempts set time_result = '1:00' where member_id = $1`, [MEMBER]), 'permission denied'))
check('member cannot hard-delete attempts', errIs(await as(MEMBER, 'delete from event_attempts where member_id = $1', [MEMBER]), 'permission denied'))

// edit / delete + history + tie-break timestamp
const a2id = (await q('select id, scored_at from event_attempts where client_attempt_id = $1', [cid(2)]))[0]
await q(`update event_attempts set scored_at = scored_at - interval '1 hour' where id = $1`, [a2id.id]) // make a change observable
const before = (await q('select scored_at from event_attempts where id = $1', [a2id.id]))[0].scored_at
const ed1 = await as(MEMBER, 'select (event_update_attempt($1, $2)).*', [a2id.id, JSON.stringify({ time_result: '09:30', completion_state: 'completed', notes: 'typo fix' })])
check('notes-only edit keeps scored_at (tie position)', !ed1.error && ed1.rows[0].scored_at.getTime() === before.getTime(), ed1)
const ed2 = await as(MEMBER, 'select (event_update_attempt($1, $2)).*', [a2id.id, JSON.stringify({ time_result: '08:45', completion_state: 'completed' })])
check('score edit resets scored_at (no earlier tie position)', !ed2.error && ed2.rows[0].scored_at.getTime() > before.getTime() && ed2.rows[0].time_result === '08:45')
check('history keeps both previous versions', (await q(`select count(*)::int n from event_attempt_history where attempt_id = $1 and op = 'update'`, [a2id.id]))[0].n >= 2)
check('member sees own history', (await as(MEMBER, 'select id from event_attempt_history')).rows.length >= 2)
check('another member cannot see that history', (await as(EXPIRED, 'select id from event_attempt_history where member_id = $1', [MEMBER])).rows.length === 0)
check("cannot edit another member's attempt", errIs(await as(EXPIRED, 'select event_update_attempt($1, $2)', [a2id.id, JSON.stringify({ time_result: '1:00' })]), 'attempt_not_found'))
check("cannot delete another member's attempt", errIs(await as(EXPIRED, 'select event_delete_attempt($1)', [a2id.id]), 'attempt_not_found'))
const a3id = (await q('select id from event_attempts where client_attempt_id = $1', [cid(3)]))[0].id
check('soft delete own attempt', (await as(MEMBER, 'select event_delete_attempt($1) r', [a3id])).rows?.[0]?.r?.deleted === true)
check('deleted attempt is preserved with deleted_at + delete history', (await q('select deleted_at from event_attempts where id = $1', [a3id]))[0].deleted_at !== null && (await q(`select count(*)::int n from event_attempt_history where attempt_id = $1 and op = 'delete'`, [a3id]))[0].n === 1)
check('deleted attempt cannot be edited', errIs(await as(MEMBER, 'select event_update_attempt($1, $2)', [a3id, JSON.stringify({ time_result: '1:00' })]), 'attempt_deleted'))
check('history rows are immutable', errIs(await as(null, `update event_attempt_history set op = 'update'`, [], 'postgres'), 'history_immutable'))
check('member cannot write history', errIs(await as(MEMBER, `insert into event_attempt_history (attempt_id, event_id, gym_id, member_id, op, old) values ($1, $2, $3, $4, 'update', '{}')`, [a2id.id, MOTM, G1, MEMBER]), 'permission denied'))

// leaderboard visibility
const lbOther = (await as(NOSUB, 'select id, deleted_at from event_attempts where event_id = $1', [MOTM])).rows
check('leaderboard: other members see live attempts only', lbOther.length === 3 && lbOther.every(r => r.deleted_at === null), lbOther.length)
check('leaderboard: own deleted attempt still visible to self', (await as(MEMBER, 'select id from event_attempts where event_id = $1 and deleted_at is not null', [MOTM])).rows.length === 1)
check('leaderboard: expired-subscription member can read it', (await as(EXPIRED, 'select id from event_attempts where event_id = $1', [MOTM])).rows.length >= 3)
check('leaderboard: other gym sees nothing', (await as(MEMBER_G2, 'select id from event_attempts')).rows.length === 0)
await as(ADMIN, 'update events set leaderboard_visible = false where id = $1', [MOTM])
check('leaderboard hidden: others see none, self sees own', (await as(NOSUB, 'select id from event_attempts where event_id = $1', [MOTM])).rows.length === 0 && (await as(MEMBER, 'select id from event_attempts where event_id = $1', [MOTM])).rows.length === 3)
await as(ADMIN, 'update events set leaderboard_visible = true where id = $1', [MOTM])

// attempt cap (safeguard 1 + 4)
section('20-attempt cap')
await join(M6, MOTM)
for (let i = 0; i < 18; i++) await submit(M6, MOTM, cid(100 + i), { result: String(100 + i) })
const m6ids = (await q('select id from event_attempts where member_id = $1 order by created_at limit 5', [M6])).map(r => r.id)
for (const id of m6ids) await as(M6, 'select event_delete_attempt($1)', [id])
check('18 created, 5 soft-deleted', (await q('select count(*)::int n, count(deleted_at)::int d from event_attempts where member_id = $1', [M6]))[0].d === 5)
await submit(M6, MOTM, cid(200), { result: '1' }); await submit(M6, MOTM, cid(201), { result: '2' })
check('20 total (incl. deleted) reached', (await q('select count(*)::int n from event_attempts where member_id = $1', [M6]))[0].n === 20)
check('21st attempt -> attempt_limit_reached (deleted ones still count)', errIs(await submit(M6, MOTM, cid(202), { result: '3' }), 'attempt_limit_reached'))
const capRetry = await submit(M6, MOTM, cid(201), { result: '2' })
check('retry at the cap returns the original (never consumes an attempt)', !capRetry.error && capRetry.rows[0].result === '2' && (await q('select count(*)::int n from event_attempts where member_id = $1', [M6]))[0].n === 20)

// windows
section('scoring window')
const FUT = (await insertEvent(ADMIN, { gym_id: G1, event_type: 'Challenge', title: 'Next', starts_at: inDays(2), ends_at: inDays(9), has_workout: true, workout_format: 'AMRAP', scoring_enabled: true })).rows[0].id
await as(ADMIN, 'select event_publish($1)', [FUT])
await join(M7, FUT)
check('before the window -> outside_scoring_window', errIs(await submit(M7, FUT, cid(300), { result: '5+3' }), 'outside_scoring_window'))
await q(`update events set starts_at = now() - interval '3 days', ends_at = now() - interval '1 hour' where id = $1`, [FUT])
check('after the window -> outside_scoring_window', errIs(await submit(M7, FUT, cid(301), { result: '5+3' }), 'outside_scoring_window'))
check('leaving a scoring event after it ended -> event_ended', errIs(await as(M7, 'select event_leave($1)', [FUT]), 'event_ended'))
// window closes on an event WITH attempts (simulate time passing past the guard)
await q('alter table events disable trigger events_edit_guard_trg')
await q(`update events set ends_at = now() - interval '1 minute' where id = $1`, [MOTM])
await q('alter table events enable trigger events_edit_guard_trg')
check('editing after the window closes -> outside_scoring_window', errIs(await as(MEMBER, 'select event_update_attempt($1, $2)', [a2id.id, JSON.stringify({ time_result: '1:00' })]), 'outside_scoring_window'))
check('deleting after the window closes -> outside_scoring_window', errIs(await as(MEMBER, 'select event_delete_attempt($1)', [a2id.id]), 'outside_scoring_window'))
await q('alter table events disable trigger events_edit_guard_trg')
await q(`update events set ends_at = now() + interval '10 days' where id = $1`, [MOTM])
await q('alter table events enable trigger events_edit_guard_trg')

// ---------- edit rules ----------
section('editing a published event with attempts (safeguard 3)')
const upd = (sql, params) => as(ADMIN, sql, params)
check('changing the format -> scoring_locked', errIs(await upd(`update events set workout_format = 'AMRAP' where id = $1`, [MOTM]), 'scoring_locked'))
check('changing the format config -> scoring_locked', errIs(await upd(`update events set workout_format_config = '{"timeCapSec": 600}' where id = $1`, [MOTM]), 'scoring_locked'))
check('turning scoring off -> scoring_locked', errIs(await upd('update events set scoring_enabled = false where id = $1', [MOTM]), 'scoring_locked'))
check('moving the start after the first attempt -> dates_would_invalidate_attempts', errIs(await upd(`update events set starts_at = now() + interval '1 hour' where id = $1`, [MOTM]), 'dates_would_invalidate_attempts'))
check('moving the end before the last attempt -> dates_would_invalidate_attempts', errIs(await upd(`update events set ends_at = now() - interval '1 day' where id = $1`, [MOTM]), 'dates_would_invalidate_attempts'))
check('extending the end is allowed', !(await upd(`update events set ends_at = now() + interval '20 days' where id = $1`, [MOTM])).error)
check('description / title edits are allowed', !(await upd(`update events set description = 'Updated standards', title = 'October Mission v2' where id = $1`, [MOTM])).error)
check('removing a division in use -> division_in_use', errIs(await upd(`update events set divisions = '{rx}' where id = $1`, [MOTM]), 'division_in_use'))
check('adding a division is allowed', !(await upd(`update events set divisions = '{rx,beginner,intermediate}' where id = $1`, [MOTM])).error)
check('capacity below current registrations -> capacity_below_registrations', errIs(await upd('update events set capacity = 1 where id = $1', [MOTM]), 'capacity_below_registrations'))
check('soft-deleted attempts are never removed by any edit', (await q('select count(*)::int n from event_attempts where event_id = $1', [MOTM]))[0].n === 24)
const NOATT = (await insertEvent(ADMIN, { gym_id: G1, event_type: 'Challenge', title: 'Fresh', starts_at: inDays(1), ends_at: inDays(5), has_workout: true, workout_format: 'AMRAP', scoring_enabled: true })).rows[0].id
check('format change allowed before the first attempt', !(await upd(`update events set workout_format = 'RFT' where id = $1`, [NOATT])).error)

// ---------- cancel / republish / archive ----------
section('cancel, republish, archive')
check('cancel the Mission', (await as(COACH, 'select event_cancel($1) r', [MOTM])).rows?.[0]?.r?.status === 'cancelled')
check('cancelled: join rejected', errIs(await join(NOSUB, MOTM), 'event_not_open'))
check('cancelled: submit rejected', errIs(await submit(MEMBER, MOTM, cid(400), { time_result: '1:00' }), 'event_not_open'))
check('cancelled: attempts kept and still readable', (await as(NOSUB, 'select id from event_attempts where event_id = $1', [MOTM])).rows.length > 0)
check('cancelled: not pending', !(await as(NOSUB, 'select id from my_pending_event_announcements()')).rows.some(r => r.id === MOTM))
await as(MEMBER, 'select event_ack_announcement($1, 1, $2)', [MOTM, 'dismissed'])
const rep = await as(ADMIN, 'select event_publish($1) r', [MOTM])
check('republish -> revision 2', rep.rows?.[0]?.r?.announcement_revision === 2, rep)
check('republished event is pending again for a member who acked revision 1', (await as(MEMBER, 'select id from my_pending_event_announcements()')).rows.some(r => r.id === MOTM))
await as(MEMBER, 'select event_ack_announcement($1, 1, $2)', [MOTM, 'dismissed'])
check('a stale ack (revision 1) does not hide revision 2', (await as(MEMBER, 'select id from my_pending_event_announcements()')).rows.some(r => r.id === MOTM))
await as(MEMBER, 'select event_ack_announcement($1, 2, $2)', [MOTM, 'dismissed'])
await as(MEMBER, 'select event_ack_announcement($1, 1, $2)', [MOTM, 'dismissed'])
check('ack revision is never lowered', (await q('select revision from event_announcement_acks where event_id = $1 and member_id = $2', [MOTM, MEMBER]))[0].revision === 2)
check('ended events are never pending', !(await as(M7, 'select id from my_pending_event_announcements()')).rows.some(r => r.id === FUT))
check('archive an ended published event', (await as(ADMIN, 'select event_archive($1) r', [FUT])).rows?.[0]?.r?.status === 'archived')
check('archived event is read-only', errIs(await upd(`update events set description = 'x' where id = $1`, [FUT]), 'event_archived_read_only'))

// ---------- integrity ----------
section('gym isolation and integrity')
check('gym_id immutable on events', errIs(await as(null, 'update events set gym_id = $2 where id = $1', [MOTM, G2], 'postgres'), 'gym_id cannot be changed'))
check('gym_id immutable on registrations', errIs(await as(null, 'update event_registrations set gym_id = $1', [G2], 'postgres'), 'gym_id cannot be changed'))
check('gym_id immutable on attempts', errIs(await as(null, 'update event_attempts set gym_id = $1', [G2], 'postgres'), 'gym_id cannot be changed'))
check('attempt cannot point to another gym than its event', errIs(await as(null, `insert into event_attempts (event_id, gym_id, member_id, client_attempt_id, division, result, format_snapshot) values ($1, $2, $3, gen_random_uuid(), 'rx', '1', 'AMRAP')`, [MOTM, G2, MEMBER_G2], 'postgres'), 'foreign key'))
check('an event with attempts can never be deleted (RESTRICT)', errIs(await as(null, 'delete from events where id = $1', [MOTM], 'postgres'), 'foreign key'))

// ---------- storage ----------
section('event-covers storage policies')
// No RETURNING: event covers deliberately have no SELECT policy (served by public URL, never listed).
const up = (uid, name) => as(uid, `insert into storage.objects (bucket_id, name, owner) values ('event-covers', $1, $2)`, [name, uid])
const up1 = await up(COACH, `${G1}/${MOTM}/cover.jpg`)
check('coach uploads into own gym folder', !up1.error, up1)
check('member cannot upload covers', errIs(await up(MEMBER, `${G1}/${MOTM}/x.jpg`), 'row-level security'))
check('admin cannot upload into another gym folder', errIs(await up(ADMIN, `${G2}/x/x.jpg`), 'row-level security'))
const delOther = await as(ADMIN_G2, `delete from storage.objects where bucket_id = 'event-covers'`)
check('other gym admin cannot delete this gym cover', (!delOther.error || errIs(delOther, 'row-level security')) && (await q(`select count(*)::int n from storage.objects where bucket_id = 'event-covers'`))[0].n === 1, delOther)
check('members cannot list cover objects (no member SELECT policy)', (await as(MEMBER, `select id from storage.objects where bucket_id = 'event-covers'`)).rows?.length === 0)
check('policies do not touch other buckets (member avatar insert still unaffected by events policies)', (await q(`select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'event_covers%' and qual not like '%event-covers%' and coalesce(with_check, '') not like '%event-covers%'`))[0].n === 0)

// ---------- no side effects ----------
section('no side effects on classes, bookings, subscriptions (safeguard 7)')
check('classes unchanged', await fp('classes') === baseline.classes)
check('bookings unchanged', await fp('bookings') === baseline.bookings)
check('subscriptions unchanged (incl. sessions_used)', await fp('subscriptions') === baseline.subscriptions)
check('memberships unchanged', await fp('memberships') === baseline.memberships)
check('profiles unchanged', await fp('profiles') === baseline.profiles)
const defs = (await q(`select string_agg(pg_get_functiondef(p.oid), '') d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'event%' or p.proname like 'forge_events%' or p.proname = 'my_pending_event_announcements')`))[0].d
check('no Events function references bookings, subscriptions, classes, orders or payments', !/\b(bookings|subscriptions|classes|orders|payments)\b/.test(defs))

// ---------- rollback ----------
section('rollback')
let rbErr = null
try { await db.exec(rollback) } catch (e) { rbErr = e.message }
check('rollback refuses while Events data exists', !!rbErr && rbErr.includes('rollback aborted'), rbErr)
await db.exec('rollback') // close the aborted transaction left open by the failed script
check('nothing was dropped by the refused rollback', (await q(`select count(*)::int n from pg_class where relname = 'events'`))[0].n === 1)
await q(`delete from storage.objects where bucket_id = 'event-covers'`)
await db.exec(`select set_config('forge.events_rollback_confirm', 'destroy-event-data', false)`)
rbErr = null
try { await db.exec(rollback) } catch (e) { rbErr = e.message }
check('confirmed rollback succeeds', !rbErr, rbErr)
const leftovers = await q(`select relname from pg_class where relname like 'event%'`)
check('no Events tables or indexes remain', leftovers.length === 0, leftovers)
const fnsAfter = (await q(`select string_agg(proname, ',' order by proname) s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`))[0].s
check('public functions identical to before the migration', fnsAfter === fnsBefore, { before: fnsBefore, after: fnsAfter })
check('realtime publication restored', (await q(`select string_agg(tablename, ',' order by tablename) s from pg_publication_tables where pubname = 'supabase_realtime'`))[0].s === pubBefore)
check('event-covers bucket and policies removed; other buckets kept', (await q(`select count(*)::int n from storage.buckets where id = 'event-covers'`))[0].n === 0 && (await q(`select count(*)::int n from pg_policies where policyname like 'event_covers%'`))[0].n === 0 && (await q(`select count(*)::int n from storage.buckets`))[0].n === 2)
check('pre-existing data intact after rollback', await fp('bookings') === baseline.bookings && await fp('subscriptions') === baseline.subscriptions && await fp('profiles') === baseline.profiles)
check('app_settings rows kept (flag row is ordinary data, not dropped)', (await q(`select count(*)::int n from app_settings`))[0].n === 2)
await db.exec(`select set_config('forge.events_rollback_confirm', '', false)`)
let reErr = null
try { await db.exec(migration) } catch (e) { reErr = e.message }
check('migration re-applies cleanly after rollback (reversible)', !reErr, reErr)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:', failures); process.exit(1) }
