// Executes the REAL migration file against an isolated in-memory Postgres
// (PGlite) seeded with a fixture that mirrors the live schema. No network,
// no Supabase project, no production data.
//
// PGlite is deliberately NOT a project dependency. Run from any scratch dir:
//   npm i @electric-sql/pglite@0.2.17
//   node <repo>/supabase/tests/class-edit/run.mjs
// (with NODE_PATH or a copy of this folder next to that node_modules).
// Not covered here: true parallel sessions (PGlite is single-connection) -
// concurrency is exercised via the optimistic stale-snapshot check only.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationPath = process.argv[2] || fileURLToPath(new URL('../../migrations/20261008090000_class_edit_series_scope.sql', import.meta.url))
const fixture = readFileSync(new URL('./fixture.sql', import.meta.url), 'utf8')
const migration = readFileSync(migrationPath, 'utf8')

const G1 = '11111111-1111-1111-1111-111111111111'
const G2 = '22222222-2222-2222-2222-222222222222'
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001'
const COACH = 'aaaaaaaa-0000-0000-0000-000000000002'
const MEMBER = 'aaaaaaaa-0000-0000-0000-000000000003'
const ADMIN_G2 = 'aaaaaaaa-0000-0000-0000-000000000004'

const db = new PGlite()
let passed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS', name) }
  else { failures.push(name); console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : '') }
}

async function q(sql, params) { return (await db.query(sql, params)).rows }
async function asUser(uid, fn) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
}
async function rpc(uid, args) {
  return asUser(uid, async () => {
    try {
      const r = await q('select edit_class_scope($1, $2, $3, $4, $5) as r',
        [args.id, args.scope, args.expected === undefined ? null : JSON.stringify(args.expected), JSON.stringify(args.changes), args.dryRun ?? false])
      return { data: r[0].r }
    } catch (e) {
      return { error: { message: e.message, detail: e.detail } }
    }
  })
}
const snap = (c) => ({ name: c.name, start_time: c.start_time, end_time: c.end_time, coach: c.coach, max_spots: c.max_spots, color: c.color })
const byId = async (id) => (await q('select * from classes where id = $1', [id]))[0]
const all = async () => q('select * from classes order by date, start_time, id')
const bookingsSnapshot = async () => q('select id, member_id, class_id, checked_in, no_show from bookings order by id')

await db.exec(fixture)
await db.exec(`
  insert into admins values ('${ADMIN}', '${G1}'), ('${ADMIN_G2}', '${G2}');
  insert into coaches values ('${COACH}', '${G1}');
  insert into profiles values ('${ADMIN}', '${G1}', 'a@x'), ('${COACH}', '${G1}', 'c@x'), ('${MEMBER}', '${G1}', 'm@x'), ('${ADMIN_G2}', '${G2}', 'b@x');
`)

// Series A: one INSERT batch (shared created_at), weekly, 2 past + 10 future, spans 3 months.
// Series B: an UNRELATED batch with the SAME name/time/coach (what the old heuristic would merge).
await db.exec(`
  with today as (select (now() at time zone 'Europe/Bucharest')::date d)
  insert into classes (name, date, start_time, end_time, coach, max_spots, created_at, gym_id, color)
  select 'CrossFit', d + 1 + 7 * k, '09:00', '10:00', 'Ana', 12, '2026-08-10 10:00:00+00', '${G1}', null
  from today, generate_series(-2, 9) k;
  with today as (select (now() at time zone 'Europe/Bucharest')::date d)
  insert into classes (name, date, start_time, end_time, coach, max_spots, created_at, gym_id)
  select 'CrossFit', d + 2 + 7 * k, '09:00', '10:00', 'Ana', 12, '2026-08-11 10:00:00+00', '${G1}'
  from today, generate_series(0, 3) k;
  insert into classes (name, date, start_time, end_time, coach, max_spots, created_at, gym_id)
  select 'Open Gym', (now() at time zone 'Europe/Bucharest')::date + 3, '18:00', '19:00', 'Ana', 12, '2026-08-12 10:00:00+00', '${G1}';
  insert into classes (name, date, start_time, end_time, coach, max_spots, created_at, gym_id)
  select 'CrossFit', (now() at time zone 'Europe/Bucharest')::date + 1, '09:00', '10:00', 'Bob', 12, '2026-08-10 10:00:00+00', '${G2}';
`)
const pre = await all()
const A = pre.filter(c => c.gym_id === G1 && c.created_at.toISOString().startsWith('2026-08-10')).sort((a, b) => a.date - b.date)
const B = pre.filter(c => c.created_at.toISOString().startsWith('2026-08-11'))
const S = pre.find(c => c.name === 'Open Gym')
const pastA = A.slice(0, 2), futA = A.slice(2)
await db.exec(`
  insert into bookings (member_id, class_id, gym_id) select '${MEMBER}', '${futA[0].id}', '${G1}' from generate_series(1, 3);
  insert into bookings (member_id, class_id, gym_id, checked_in) select '${MEMBER}', '${pastA[1].id}', '${G1}', true from generate_series(1, 2);
`)
const bookingsBefore = await bookingsSnapshot()

console.log('\n[migration]')
await db.exec(migration)
let rows = await all()
const sid = (id) => rows.find(r => r.id === id).series_id
check('backfill: series A rows share one series_id', new Set(A.map(c => sid(c.id))).size === 1 && sid(A[0].id) !== null)
check('backfill: unrelated batch B gets a DIFFERENT series_id (no name/time/coach merge)', new Set(B.map(c => sid(c.id))).size === 1 && sid(B[0].id) !== sid(A[0].id))
check('backfill: one-off class stays NULL', sid(S.id) === null)
check('backfill: other gym batch-of-1 stays NULL', rows.find(r => r.gym_id === G2).series_id === null)
check('backfill: every series_exception defaults false', rows.every(r => r.series_exception === false))
const sidsBefore = rows.map(r => r.series_id)
await db.exec(migration)
rows = await all()
check('migration re-run is a no-op for series identity', JSON.stringify(rows.map(r => r.series_id)) === JSON.stringify(sidsBefore))

console.log('\n[authorization]')
let r = await rpc(MEMBER, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { name: 'X' } })
check('member cannot edit (not_authorized)', r.error?.message === 'not_authorized', r)
r = await rpc(ADMIN_G2, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { name: 'X' } })
check('other-gym admin cannot see the class (class_not_found)', r.error?.message === 'class_not_found', r)
await db.exec(`set role anon;`)
try { await q(`select edit_class_scope('${futA[1].id}', 'this', null, '{"name":"X"}')`); check('anon has no EXECUTE', false) }
catch (e) { check('anon has no EXECUTE', /permission denied/.test(e.message), e.message) }
await db.exec(`reset role;`)

console.log('\n[validation]')
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: {} })
check('empty changes rejected (no_changes)', r.error?.message === 'no_changes', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { date: '2030-01-01' } })
check('unsupported field rejected', r.error?.message === 'invalid_changes', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { name: '   ' } })
check('blank name rejected', r.error?.message === 'invalid_name', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { end_time: '08:30' } })
check('end before start rejected', r.error?.message === 'invalid_time_range', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { max_spots: 0 } })
check('capacity 0 rejected', r.error?.message === 'invalid_capacity', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { max_spots: 2.5 } })
check('fractional capacity rejected', r.error?.message === 'invalid_capacity', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { color: 'red' } })
check('non-hex color rejected', r.error?.message === 'invalid_color', r)
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', changes: { name: 'X' } })
check('write without expected snapshot rejected', r.error?.message === 'missing_expected', r)
r = await rpc(ADMIN, { id: S.id, scope: 'future', expected: snap(S), changes: { name: 'X' } })
check('series scope on one-off class rejected (not_a_series)', r.error?.message === 'not_a_series', r)
r = await rpc(ADMIN, { id: pastA[1].id, scope: 'series', expected: snap(pastA[1]), changes: { name: 'X' } })
check('series scope from an ended occurrence rejected', r.error?.message === 'series_scope_on_ended_class', r)

console.log('\n[capacity vs reservations]')
r = await rpc(ADMIN, { id: futA[0].id, scope: 'this', expected: snap(futA[0]), changes: { max_spots: 2 } })
check('single: capacity below 3 bookings blocked', r.error?.message === 'capacity_below_bookings' && JSON.parse(r.error.detail)[0].booked === 3, r)
r = await rpc(ADMIN, { id: futA[3].id, scope: 'series', expected: snap(futA[3]), changes: { max_spots: 2, name: 'Renamed' } })
check('series: one violating occurrence blocks the whole edit', r.error?.message === 'capacity_below_bookings', r)
rows = await all()
check('series: rollback - no occurrence renamed after the blocked edit', rows.filter(x => x.name === 'Renamed').length === 0)
r = await rpc(ADMIN, { id: futA[0].id, scope: 'this', expected: snap(futA[0]), changes: { max_spots: 3 } })
check('single: capacity exactly = bookings allowed', r.data?.affected === 1, r)
futA[0] = await byId(futA[0].id)

console.log('\n[scope: this class only]')
r = await rpc(ADMIN, { id: futA[1].id, scope: 'this', expected: snap(futA[1]), changes: { name: 'Strength' } })
rows = await all()
check('this: exactly 1 row affected', r.data?.affected === 1, r)
check('this: only the selected occurrence renamed', rows.filter(x => x.name === 'Strength').map(x => x.id).join() === futA[1].id)
check('this: occurrence keeps its series_id', rows.find(x => x.id === futA[1].id).series_id === sid(futA[1].id))
check('this: occurrence marked series_exception', rows.find(x => x.id === futA[1].id).series_exception === true)
futA[1] = await byId(futA[1].id)

console.log('\n[concurrency]')
const stale = { ...snap(futA[2]) }
r = await rpc(COACH, { id: futA[2].id, scope: 'this', expected: snap(futA[2]), changes: { coach: 'Coach Two' } })
check('coach can edit (session 1)', r.data?.affected === 1, r)
r = await rpc(ADMIN, { id: futA[2].id, scope: 'this', expected: stale, changes: { name: 'Lost update' } })
check('session 2 with stale snapshot rejected (no lost update)', r.error?.message === 'class_changed_concurrently', r)
futA[2] = await byId(futA[2].id)
check('futA[2] is now a customized exception (coach edit)', futA[2].series_exception === true)

console.log('\n[scope: this and future] (anchor = futA[3])')
const anchor = await byId(futA[3].id)
r = await rpc(ADMIN, { id: anchor.id, scope: 'future', expected: snap(anchor), changes: { start_time: '09:30', end_time: '10:30' }, dryRun: true })
check('future dry run: affected = futA[3..9] = 7', r.data?.affected === 7, r.data)
check('future dry run writes nothing', (await byId(anchor.id)).start_time === '09:00:00')
r = await rpc(ADMIN, { id: anchor.id, scope: 'future', expected: snap(anchor), changes: { start_time: '09:30', end_time: '10:30' } })
rows = await all()
const moved = rows.filter(x => x.start_time === '09:30:00').map(x => x.id).sort()
check('future: exactly futA[3..9] moved', JSON.stringify(moved) === JSON.stringify(futA.slice(3).map(x => x.id).sort()), r)
check('future: earlier occurrences untouched', rows.filter(x => [futA[0].id, ...pastA.map(p => p.id)].includes(x.id)).every(x => x.start_time === '09:00:00'))
check('future: unrelated same-name series B untouched', rows.filter(x => B.some(b => b.id === x.id)).every(x => x.start_time === '09:00:00' && x.name === 'CrossFit'))
check('future: bulk edit does NOT mark rows as exceptions', rows.filter(x => futA.slice(3).some(f => f.id === x.id)).every(x => x.series_exception === false))
check('future: final occurrence included', rows.find(x => x.id === futA[9].id).start_time === '09:30:00')

console.log('\n[scope: entire series] (anchor = futA[5])')
const a5 = await byId(futA[5].id)
r = await rpc(ADMIN, { id: a5.id, scope: 'series', expected: snap(a5), changes: { name: 'Functional Fitness', coach: 'Ana M.' }, dryRun: true })
check('series dry run: skips 3 customized occurrences (capacity, rename, coach edits)', r.data?.skipped_exceptions === 3, r.data)
check('series dry run: reports 2 preserved past occurrences', r.data?.preserved_past === 2, r.data)
check('series dry run: affected = 10 future - 3 exceptions = 7', r.data?.affected === 7, r.data)
check('series dry run: booked_total = 0 (booked futA[0] is a skipped exception)', r.data?.booked_total === 0, r.data)
r = await rpc(ADMIN, { id: a5.id, scope: 'series', expected: snap(a5), changes: { name: 'Functional Fitness', coach: 'Ana M.' } })
rows = await all()
const ff = rows.filter(x => x.name === 'Functional Fitness')
check('series: 7 rows renamed', ff.length === 7 && r.data?.affected === 7, r)
check('series: customized "Strength" occurrence preserved', rows.find(x => x.id === futA[1].id).name === 'Strength')
check('series: customized capacity edit preserved', rows.find(x => x.id === futA[0].id).max_spots === 3 && rows.find(x => x.id === futA[0].id).name === 'CrossFit')
check('series: customized coach edit preserved', rows.find(x => x.id === futA[2].id).coach === 'Coach Two')
check('series: past occurrences NOT rewritten', rows.filter(x => pastA.some(p => p.id === x.id)).every(x => x.name === 'CrossFit' && x.coach === 'Ana'))
check('series: only changed fields written (times of futA[0] kept 09:00, futA[3+] kept 09:30)',
  rows.find(x => x.id === futA[0].id).start_time === '09:00:00' && rows.find(x => x.id === futA[4].id).start_time === '09:30:00')
check('series: unrelated series B untouched', rows.filter(x => B.some(b => b.id === x.id)).every(x => x.name === 'CrossFit'))
check('series: other gym untouched', rows.find(x => x.gym_id === G2).name === 'CrossFit')
check('series: spans multiple months', new Set(ff.map(x => x.date.toISOString().slice(0, 7))).size >= 2)

console.log('\n[duplicates]')
const b0 = await byId(B[0].id)
// futA[0] is d+1, B[0] is d+2. Single-edit B[0] to collide with nothing first, then try a real collision:
const fa0 = await byId(futA[0].id)
r = await rpc(ADMIN, { id: S.id, scope: 'this', expected: snap(S), changes: { name: 'Functional Fitness', start_time: '09:30', end_time: '10:30' } })
check('one-off class edited (no collision on its own date)', r.data?.affected === 1, r)
const s2 = await byId(S.id)
r = await rpc(ADMIN, { id: b0.id, scope: 'this', expected: snap(b0), changes: { name: fa0.name } })
check('rename to a name that exists on a DIFFERENT date is fine', r.data?.affected === 1, r)
// Insert a sibling class on S's date, then try to make S identical to it.
await db.exec(`insert into classes (name, date, start_time, end_time, coach, gym_id) values ('Yoga', '${s2.date.toISOString().slice(0, 10)}', '12:00', '13:00', 'Ana', '${G1}')`)
r = await rpc(ADMIN, { id: S.id, scope: 'this', expected: snap(s2), changes: { name: 'Yoga', start_time: '12:00', end_time: '13:00' } })
check('edit that would duplicate an existing class slot is blocked', r.error?.message === 'duplicate_class', r)

console.log('\n[history + direct-write guards]')
const p1 = await byId(pastA[1].id)
r = await rpc(ADMIN, { id: p1.id, scope: 'this', expected: snap(p1), changes: { coach: 'Corrected Coach' } })
check('past class with attendance: single correction allowed', r.data?.affected === 1, r)
await asUser(ADMIN, async () => {
  try { await q(`update classes set series_id = gen_random_uuid() where id = '${futA[4].id}'`); check('client cannot change series_id', false) }
  catch (e) { check('client cannot change series_id', /series_id_immutable/.test(e.message), e.message) }
  await q(`update classes set series_exception = false where id = '${futA[1].id}'`)
  await q(`update classes set series_exception = true where id = '${futA[6].id}'`)
})
check('client cannot clear series_exception directly', (await byId(futA[1].id)).series_exception === true)
check('client cannot set series_exception without a real change', (await byId(futA[6].id)).series_exception === false)
await asUser(ADMIN, async () => { await q(`update classes set coach = 'Direct' where id = '${futA[7].id}'`) })
check('direct single-row update (forge-admin-web path) marks exception', (await byId(futA[7].id)).series_exception === true)
await asUser(ADMIN, async () => {
  try { await q(`update classes set max_spots = 1 where id = '${futA[0].id}'`); check('existing capacity trigger still enforced on direct update', false) }
  catch (e) { check('existing capacity trigger still enforced on direct update', /already booked/.test(e.message), e.message) }
})

console.log('\n[reservations preserved]')
const bookingsAfter = await bookingsSnapshot()
check('bookings: identical rows, ids, members, class links, attendance', JSON.stringify(bookingsAfter) === JSON.stringify(bookingsBefore))

console.log('\n[existing delete functionality unaffected]')
await asUser(ADMIN, async () => {
  try { await q(`delete from classes where id = '${pastA[1].id}'`); check('past class with attendance still undeletable', false) }
  catch (e) { check('past class with attendance still undeletable', /recorded attendance/.test(e.message), e.message) }
  const del = await q(`delete from classes where id = '${futA[0].id}' returning id`)
  check('future class with bookings still deletable (bookings removed atomically)', del.length === 1)
})
check('deleted class bookings removed by P0-01 trigger', (await q(`select count(*)::int n from bookings where class_id = '${futA[0].id}'`))[0].n === 0)
await asUser(ADMIN, async () => {
  const ins = await q(`insert into classes (name, date, start_time, end_time, coach, gym_id, series_id) values ('New', current_date + 30, '07:00', '08:00', 'Ana', '${G1}', gen_random_uuid()) returning series_id, series_exception`)
  check('new recurring insert can carry a series_id', ins[0].series_id !== null && ins[0].series_exception === false)
})

// ============================================================
// Final integration (2026-10-08 pass 2)
// ============================================================
const ins = (sql) => asUser(ADMIN, () => q(sql))
const today = `(now() at time zone 'Europe/Bucharest')::date`
// What the new clients insert: one recurring create = one INSERT with one shared series_id.
const newSeries = async (name, coach, startOffset, weeks) => {
  const s = (await q('select gen_random_uuid() u'))[0].u
  await ins(`insert into classes (name, date, start_time, end_time, coach, max_spots, gym_id, series_id)
    select '${name}', ${today} + ${startOffset} + 7 * k, '17:00', '18:00', '${coach}', 10, '${G1}', '${s}' from generate_series(0, ${weeks - 1}) k`)
  return { sid: s, rows: await q(`select * from classes where series_id = $1 order by date`, [s]) }
}
// The exact query shape of PWA stergeSeria / forge fetchSeriesScopeInfo after this pass:
// name/start/end/coach, date >= today, AND confined to the class's own series (scopeToOwnSeries).
const deleteSeriesScoped = (c) => ins(`delete from classes where name = '${c.name}' and start_time = '${c.start_time}' and end_time = '${c.end_time}'
  and coach = '${c.coach}' and date >= ${today} and ${c.series_id ? `series_id = '${c.series_id}'` : 'series_id is null'} returning id`)
const heuristicCount = async (c) => (await q(`select count(*)::int n from classes where name = '${c.name}' and start_time = '${c.start_time}'
  and end_time = '${c.end_time}' and coach = '${c.coach}' and date >= ${today}`))[0].n

console.log('\n[delete series: confined to the real series]')
const D = await newSeries('Delete Me', 'Ana', 5, 6)
const E = await newSeries('Delete Me', 'Ana', 6, 6) // unrelated schedule, identical name/time/coach
await ins(`insert into classes (name, date, start_time, end_time, coach, max_spots, gym_id) values ('Delete Me', ${today} + 4, '17:00', '18:00', 'Ana', 10, '${G1}')`) // one-off look-alike
const F = (await q(`select * from classes where name = 'Delete Me' and series_id is null`))[0]
// One occurrence of D moved individually (time edit) -> exception, no longer matches the fields.
let r2 = await rpc(ADMIN, { id: D.rows[2].id, scope: 'this', expected: snap(D.rows[2]), changes: { start_time: '17:30', end_time: '18:30' } })
check('setup: D[2] moved individually', r2.data?.affected === 1, r2)
check('old field-only heuristic would have matched D + E + the one-off (12 rows)', (await heuristicCount(D.rows[0])) === 6 + 6 + 1 - 1)
const deleted = (await deleteSeriesScoped(D.rows[0])).map(x => x.id).sort()
check('scoped delete removes exactly D minus its moved occurrence (5 rows)', deleted.length === 5 && deleted.every(id => D.rows.some(d => d.id === id)))
check('unrelated look-alike series E untouched', (await q(`select count(*)::int n from classes where series_id = $1`, [E.sid]))[0].n === 6)
check('one-off look-alike untouched', !!(await byId(F.id)))
check('individually moved occurrence of D survives (same as before)', !!(await byId(D.rows[2].id)))
const deletedOneOff = await deleteSeriesScoped(F)
check('delete series on a one-off only reaches series-less rows', deletedOneOff.length === 1 && deletedOneOff[0].id === F.id)
check('...and E is still intact afterwards', (await q(`select count(*)::int n from classes where series_id = $1`, [E.sid]))[0].n === 6)
// A series-wide time change that makes E look like another series must not merge them for delete.
const G = await newSeries('Delete Me', 'Ana', 7, 3)
await q(`update classes set start_time = '06:00', end_time = '07:00' where series_id = $1`, [G.sid]) // owner-side setup, not via clients
const e0 = await byId(E.rows[0].id)
r2 = await rpc(ADMIN, { id: e0.id, scope: 'series', expected: snap(e0), changes: { start_time: '06:00', end_time: '07:00' } })
check('setup: E moved series-wide to 06:00 (no exceptions created)', r2.data?.affected === 6, r2)
const e0b = await byId(E.rows[0].id)
const delE = await deleteSeriesScoped(e0b)
check('after edits make two series identical, delete still removes only its own (6)', delE.length === 6)
check('look-alike series G untouched', (await q(`select count(*)::int n from classes where series_id = $1`, [G.sid]))[0].n === 3)

console.log('\n[cross-client creates]')
const H = await newSeries('Forge Recurring', 'Ana', 3, 4) // forge-admin-web createRecurringClasses shape
check('forge-style recurring create: one shared series_id, not exceptions', H.rows.length === 4 && H.rows.every(x => x.series_id === H.sid && !x.series_exception))
const h0 = H.rows[0]
r2 = await rpc(ADMIN, { id: h0.id, scope: 'series', dryRun: true, changes: { coach: 'Coach Two' } })
check('forge-created series is editable as a series by the PWA RPC', r2.data?.affected === 4, r2)
await ins(`insert into classes (name, date, start_time, end_time, coach, max_spots, gym_id)
  select 'Old Client', ${today} + 3 + 7 * k, '12:00', '13:00', 'Ana', 10, '${G1}' from generate_series(0, 2) k`) // a not-yet-updated client
const oc = (await q(`select * from classes where name = 'Old Client' order by date`))
check('old-client recurring insert after migration: series_id stays NULL', oc.every(x => x.series_id === null))
r2 = await rpc(ADMIN, { id: oc[0].id, scope: 'future', expected: snap(oc[0]), changes: { name: 'X' } })
check('...and can only be edited one class at a time (not_a_series, nothing written)', r2.error?.message === 'not_a_series' && (await byId(oc[1].id)).name === 'Old Client')
// Deployed (pre-update) forge-admin-web bulk edit = plain multi-row UPDATE without the RPC:
await ins(`update classes set coach = 'Legacy' where id in ('${H.rows[2].id}', '${H.rows[3].id}')`)
const hl = await q(`select series_exception from classes where id in ('${H.rows[2].id}', '${H.rows[3].id}')`)
check('legacy direct bulk UPDATE is treated as individual edits (marked exceptions, never silently merged)', hl.every(x => x.series_exception === true))

console.log('\n[three scopes preserve bookings + attendance]')
const K = await newSeries('Booked', 'Ana', 1, 5)
await q(`insert into bookings (member_id, class_id, gym_id, checked_in, no_show) values
  ('${MEMBER}', '${K.rows[0].id}', '${G1}', true, false),
  ('${ADMIN}', '${K.rows[0].id}', '${G1}', false, true),
  ('${MEMBER}', '${K.rows[1].id}', '${G1}', false, false),
  ('${MEMBER}', '${K.rows[2].id}', '${G1}', false, false),
  ('${COACH}', '${K.rows[2].id}', '${G1}', false, false),
  ('${MEMBER}', '${K.rows[4].id}', '${G1}', true, false)`)
const kb = async () => q(`select id, member_id, class_id, checked_in, no_show, created_at from bookings where class_id = any($1) order by id`, [K.rows.map(x => x.id)])
const kBefore = JSON.stringify(await kb())
let k1 = await byId(K.rows[1].id)
r2 = await rpc(ADMIN, { id: k1.id, scope: 'this', expected: snap(k1), changes: { coach: 'Coach Two', max_spots: 1 } })
check('this: capacity = its 1 booking accepted', r2.data?.affected === 1, r2)
check('this: bookings + attendance unchanged', JSON.stringify(await kb()) === kBefore)
let k2 = await byId(K.rows[2].id)
r2 = await rpc(ADMIN, { id: k2.id, scope: 'future', expected: snap(k2), changes: { max_spots: 1 } })
check('future: capacity 1 below K[2]\'s 2 bookings blocked for the whole scope', r2.error?.message === 'capacity_below_bookings' && JSON.parse(r2.error.detail).length === 1, r2)
r2 = await rpc(ADMIN, { id: k2.id, scope: 'future', expected: snap(k2), changes: { start_time: '17:15', end_time: '18:15', max_spots: 2 } })
check('future: exactly K[2..4] moved (3 rows)', r2.data?.affected === 3, r2)
check('future: bookings + attendance unchanged', JSON.stringify(await kb()) === kBefore)
const k0 = await byId(K.rows[0].id)
r2 = await rpc(ADMIN, { id: k0.id, scope: 'series', expected: snap(k0), changes: { name: 'Booked Renamed' } })
check('series: K[0], K[2..4] renamed (4 rows), exception K[1] kept', r2.data?.affected === 4 && (await byId(K.rows[1].id)).name === 'Booked', r2)
check('series: bookings + attendance unchanged (ids, members, links, checked_in, no_show)', JSON.stringify(await kb()) === kBefore)

console.log('\n[authorization matrix]')
const k3 = await byId(K.rows[3].id)
for (const [who, uid, want] of [['member', MEMBER, 'not_authorized'], ['other-gym admin', ADMIN_G2, 'class_not_found']]) {
  for (const scope of ['this', 'future', 'series']) {
    r2 = await rpc(uid, { id: k3.id, scope, expected: snap(k3), changes: { name: 'Hacked' } })
    check(`${who} ${scope}: rejected (${want})`, r2.error?.message === want, r2)
    r2 = await rpc(uid, { id: k3.id, scope, dryRun: true, changes: { name: 'Hacked' } })
    check(`${who} ${scope} dry run: rejected - no counts leaked`, r2.error?.message === want, r2)
  }
}
const memberDirect = await asUser(MEMBER, () => q(`update classes set name = 'Hacked' where id = '${k3.id}' returning id`))
check('member direct UPDATE on classes: 0 rows (RLS)', memberDirect.length === 0)
check('nothing renamed "Hacked"', (await q(`select count(*)::int n from classes where name = 'Hacked'`))[0].n === 0)
r2 = await rpc(COACH, { id: k3.id, scope: 'series', dryRun: true, changes: { name: 'Coach Edit' } })
check('coach of the gym may use the RPC (same as classes_admin_update policy)', r2.data?.affected >= 1, r2)
const pubExec = (await q(`select has_function_privilege('public', 'edit_class_scope(uuid, text, jsonb, jsonb, boolean)', 'execute') p,
  has_function_privilege('anon', 'edit_class_scope(uuid, text, jsonb, jsonb, boolean)', 'execute') a,
  has_function_privilege('authenticated', 'edit_class_scope(uuid, text, jsonb, jsonb, boolean)', 'execute') u,
  (select prosecdef from pg_proc where proname = 'edit_class_scope') d`))[0]
check('EXECUTE: not PUBLIC, not anon, granted to authenticated; SECURITY INVOKER', !pubExec.p && !pubExec.a && pubExec.u && pubExec.d === false, pubExec)
const guc = await asUser(MEMBER, async () => {
  await q(`select set_config('forge.class_series_edit', 'on', false)`)
  const r = await q(`update classes set name = 'Hacked' where id = '${k3.id}' returning id`)
  await q(`select set_config('forge.class_series_edit', '', false)`)
  return r
})
check('setting the series-edit GUC grants a member nothing (RLS still blocks)', guc.length === 0)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:', failures); process.exit(1) }
