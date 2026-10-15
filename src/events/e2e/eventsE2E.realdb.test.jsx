/* global process */
// FORGE EVENTS - END-TO-END ACCEPTANCE against the REAL Phase 1 migration in
// a DISPOSABLE local Postgres (supabase/tests/forge-events/pg/setup.sh).
// Opt-in: FORGE_EVENTS_E2E=1 (skipped in the normal suite - it needs Docker).
// Repeatable: each describe block starts with resetEventsData() (Events rows
// only, guarded by the disposable-database marker), so earlier runs'
// announcements / attempts never change the outcome. setup.sh is needed once.
//
// What is real: the migration (tables, RLS, grants, RPCs, triggers), the
// member UI (EventsScreen) and hooks (useEventAnnouncements), score
// composition, idempotency and ranking modules - all unmodified.
// What is substituted: supabase-js/PostgREST HTTP -> realDbApi.js runs the
// same queries/RPCs as SQL under role `authenticated` with the member's JWT
// claims. Staff steps use the exact column-granted insert + event_publish the
// Admin Events client issues.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, renderHook, act, configure } from '@testing-library/react'
import { psql, memberApi, staffApi, resetEventsData } from './realDbApi'
import EventsScreen from '../EventsScreen'
import { useEventAnnouncements } from '../useEventAnnouncements'
import { rankEventLeaderboard } from '../eventLeaderboard'
import { composeEventScoreFields } from '../eventScoring'
import { newClientAttemptId } from '../attemptIdempotency'
import { isEventsPaywallExempt } from '../eventsNavigation'

const RUN = process.env.FORGE_EVENTS_E2E === '1'
configure({ asyncUtilTimeout: 20000 })

const G1 = '11111111-1111-1111-1111-111111111111'
const u = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = u(1)
const MEMBER = u(3) // active subscription
const EXPIRED = u(4) // expired membership + inactive subscription
const OTHER = u(6)

const FINGERPRINT = `select md5(string_agg(h, '|' order by h)) from (
  select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) h from classes t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from bookings t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from subscriptions t
  union all select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from memberships t) x;`

const screenFor = (memberId, eventId, version = 0) => (
  <EventsScreen gymId={G1} memberId={memberId} version={version} eventId={eventId} onOpenEvent={() => {}}
    showToast={vi.fn()} memberWeightUnit="kg" lang="en" t={{}} api={memberApi(memberId)} />
)

const enterAmrap = (rounds, reps = '') => {
  fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: rounds } })
  if (reps !== '') fireEvent.change(screen.getByLabelText('Additional reps'), { target: { value: reps } })
}

describe.skipIf(!RUN)('FORGE Events end-to-end (real database)', () => {
  let eventId
  let fingerprintBefore

  beforeAll(() => {
    resetEventsData()
    // Test-only `members` table (identity source the PWA reads; not part of the Events migration).
    psql(`drop table if exists members;
      create table if not exists members (id uuid primary key, full_name text, gender text, weight_unit text);
      insert into members values ('${MEMBER}', 'Ana Pop', 'feminin', 'kg'), ('${EXPIRED}', 'Expired Ed', 'masculin', 'kg'), ('${OTHER}', 'Mihai Ene', 'masculin', 'kg')
      on conflict do nothing;
      grant select on members to authenticated;`)
    fingerprintBefore = psql(FINGERPRINT)
  })

  it('1. admin creates an event (draft - invisible to members)', async () => {
    const created = staffApi(ADMIN).createEvent(G1, {
      event_type: 'Mission of the Month', title: 'E2E Mission', description: 'AMRAP 12', location: 'Box C15',
      starts_at: new Date(Date.now() - 3600_000).toISOString(), ends_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
      registration_enabled: true, capacity: 30, registration_deadline: null, participants_visible: true,
      has_workout: true, workout_format: 'AMRAP', workout_format_config: { durationSec: 720 },
      workout_description: '5 Pull-ups\n10 Push-ups\n15 Air Squats', workout_standards: 'Chest to bar for RX',
      scoring_enabled: true, leaderboard_visible: true, divisions: ['rx', 'beginner'],
    })
    eventId = created.id
    expect(created.status).toBe('draft')
    expect((await memberApi(MEMBER).fetchMemberEvents(G1)).some((e) => e.id === eventId)).toBe(false)
  })

  it('2. admin publishes it (announcement revision 1)', () => {
    expect(staffApi(ADMIN).publishEvent(eventId)).toMatchObject({ status: 'published', announcement_revision: 1 })
  })

  it('3-4. member receives the announcement and joins with a division through it', async () => {
    const api = memberApi(MEMBER)
    const { result } = renderHook(() => useEventAnnouncements({ enabled: true, userId: MEMBER, version: 0, api }))
    await waitFor(() => expect(result.current.current?.id).toBe(eventId))
    expect(result.current.current.announcement_revision).toBe(1)
    await act(() => result.current.join('beginner'))
    expect(result.current.error).toBeNull()
    const regs = await api.fetchMyRegistrations(G1, MEMBER)
    expect(regs.find((r) => r.event_id === eventId)).toMatchObject({ status: 'registered', division: 'beginner' })
    // acknowledged server-side -> no longer pending
    expect((await api.fetchPendingAnnouncements()).some((a) => a.id === eventId)).toBe(false)
  })

  it('5-7. first attempt, a better attempt, best one selected (UI + DB)', async () => {
    render(screenFor(MEMBER, eventId))
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    enterAmrap('7', '12')
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await screen.findByText('1/20 attempts used')
    fireEvent.click(screen.getByRole('button', { name: 'Add an attempt' }))
    enterAmrap('9')
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await screen.findByText('2/20 attempts used')
    const best = within(screen.getByRole('region', { name: 'Your attempts' })).getByText('Best').closest('li')
    expect(best).toHaveTextContent('9 rounds')
    const board = within(screen.getByRole('region', { name: 'Leaderboard' })).getByRole('list', { name: /Leaderboard Scaled/ })
    expect(within(board).getAllByRole('listitem')).toHaveLength(1)
    expect(board).toHaveTextContent(/Ana Pop.*9 rounds/)
    const stored = await memberApi(MEMBER).fetchAttempts(G1, eventId)
    expect(stored.map((a) => [a.result, a.division, a.format_snapshot])).toEqual([['7 runde + 12', 'beginner', 'AMRAP'], ['9 runde complete', 'beginner', 'AMRAP']])
  })

  it('8-9. edit an attempt -> leaderboard recalculates; delete it -> recalculates again', async () => {
    render(screenFor(MEMBER, eventId))
    fireEvent.click(await screen.findByRole('button', { name: /^Edit 7 rounds \+ 12/ }))
    enterAmrap('10', '')
    fireEvent.change(screen.getByLabelText('Additional reps'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Your attempts' })).getByText('Best').closest('li')).toHaveTextContent('10 rounds'))
    expect(screen.getByRole('list', { name: /Leaderboard Scaled/ })).toHaveTextContent('10 rounds')

    fireEvent.click(screen.getByRole('button', { name: /^Delete 10 rounds/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(screen.getByRole('list', { name: /Leaderboard Scaled/ })).toHaveTextContent('9 rounds'))
    expect(screen.getByText('Deleted')).toBeInTheDocument()
    expect(screen.getByText('2/20 attempts used')).toBeInTheDocument() // soft-deleted still counts
    const history = psql(`select count(*) from event_attempt_history where event_id = '${eventId}'`)
    expect(Number(history)).toBe(2) // one edit + one delete, append-only
  })

  it('10. idempotent retry with the same client_attempt_id never consumes a second attempt', async () => {
    const api = memberApi(MEMBER)
    const event = await api.fetchEvent(G1, eventId)
    const cid = newClientAttemptId()
    const fields = composeEventScoreFields(event, { roundsCompleted: '8' })
    const a = await api.submitAttempt(eventId, cid, fields)
    const b = await api.submitAttempt(eventId, cid, fields)
    expect(b.id).toBe(a.id)
    expect((await api.fetchAttempts(G1, eventId)).filter((x) => x.member_id === MEMBER)).toHaveLength(3)
  })

  it('12. another member scores -> the first member sees the refreshed leaderboard (version bump)', async () => {
    const other = memberApi(OTHER)
    await other.joinEvent(eventId, 'beginner')
    const event = await other.fetchEvent(G1, eventId)
    await other.submitAttempt(eventId, newClientAttemptId(), composeEventScoreFields(event, { roundsCompleted: '11', additionalReps: '4' }))
    const { rerender } = render(screenFor(MEMBER, eventId, 0))
    const list = await screen.findByRole('list', { name: /Leaderboard Scaled/ })
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/Mihai Ene.*11 rounds \+ 4/))
    // a further change arrives as a Realtime-driven version bump
    await other.submitAttempt(eventId, newClientAttemptId(), composeEventScoreFields(event, { roundsCompleted: '12' }))
    rerender(screenFor(MEMBER, eventId, 1))
    await waitFor(() => expect(within(screen.getByRole('list', { name: /Leaderboard Scaled/ })).getAllByRole('listitem')[0]).toHaveTextContent('12 rounds'))
    // Men filter keeps Mihai, Women keeps Ana
    fireEvent.click(screen.getByRole('button', { name: 'Women' }))
    expect(screen.getByRole('list', { name: /Leaderboard Scaled/ })).toHaveTextContent('Ana Pop')
    expect(screen.getByRole('list', { name: /Leaderboard Scaled/ })).not.toHaveTextContent('Mihai Ene')
  })

  it('13. expired-subscription member completes the Events flow; classes stay restricted; no class/subscription data changes', async () => {
    const api = memberApi(EXPIRED)
    // still gets the announcement
    expect((await api.fetchPendingAnnouncements()).some((a) => a.id === eventId)).toBe(true)
    render(screenFor(EXPIRED, eventId))
    fireEvent.click(await screen.findByRole('button', { name: 'Join event' }))
    expect(await screen.findByText(/You're registered · RX/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    enterAmrap('6', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await screen.findByText('1/20 attempts used')
    // the paywall exemption covers the Events screen only
    expect(isEventsPaywallExempt('events', true)).toBe(true)
    for (const s of ['home', 'log', 'clasament', 'abonament']) expect(isEventsPaywallExempt(s, true)).toBe(false)
    // nothing outside Events changed: classes, bookings, subscriptions (incl. sessions_used), memberships
    expect(psql(FINGERPRINT)).toBe(fingerprintBefore)
  })

  it('admin view of results (staff RLS) sees every attempt incl. deleted; ranking matches the member view', async () => {
    const staffRows = staffApi(ADMIN).attemptsAsStaff(eventId)
    expect(staffRows.some((a) => a.deleted_at)).toBe(true)
    const event = await memberApi(MEMBER).fetchEvent(G1, eventId)
    const members = await memberApi(MEMBER).fetchMembersByIds(staffRows.map((a) => a.member_id))
    const staffTop = rankEventLeaderboard(event, staffRows, members, { division: 'beginner' })[0]
    const memberTop = rankEventLeaderboard(event, await memberApi(MEMBER).fetchAttempts(G1, eventId), members, { division: 'beginner' })[0]
    expect(staffTop.attempt.id).toBe(memberTop.attempt.id)
  })

  it('feature flag OFF hides everything server-side, then ON restores it', async () => {
    psql(`update app_settings set value = 'false' where gym_id = '${G1}' and key = 'events_enabled'`)
    const api = memberApi(MEMBER)
    expect(await api.fetchEventsEnabled(G1)).toBe(false)
    expect(await api.fetchMemberEvents(G1)).toEqual([])
    expect(await api.fetchPendingAnnouncements()).toEqual([])
    await expect(api.joinEvent(eventId, 'rx')).rejects.toThrow('event_not_found')
    psql(`update app_settings set value = 'true' where gym_id = '${G1}' and key = 'events_enabled'`)
    expect((await api.fetchMemberEvents(G1)).some((e) => e.id === eventId)).toBe(true)
  })
}, 300000)

describe.skipIf(!RUN)('Phase 3.1 - Max Effort score types + Once (real database)', () => {
  beforeAll(() => resetEventsData())
  const window_ = () => ({ starts_at: new Date(Date.now() - 3600_000).toISOString(), ends_at: new Date(Date.now() + 2 * 86400_000).toISOString() })
  const createPublished = (title, workout_format, workout_format_config) => {
    const ev = staffApi(ADMIN).createEvent(G1, {
      event_type: 'Mission of the Month', title, description: null, location: null, ...window_(),
      registration_enabled: true, capacity: null, registration_deadline: null, participants_visible: true,
      has_workout: true, workout_format, workout_format_config, workout_description: 'Max out', workout_standards: null,
      scoring_enabled: true, leaderboard_visible: true, divisions: ['rx'],
    })
    staffApi(ADMIN).publishEvent(ev.id)
    return ev.id
  }
  const submit = async (memberId, eventId, value, unit = 'kg') => {
    const api = memberApi(memberId)
    await api.joinEvent(eventId, 'rx').catch(() => {})
    const event = await api.fetchEvent(G1, eventId)
    return api.submitAttempt(eventId, newClientAttemptId(), composeEventScoreFields(event, value, unit))
  }

  it('LOAD: kg and lb members ranked in kg; weight_unit + scoreUnit frozen on the attempt', async () => {
    const id = createPublished('Max Deadlift', 'Max Effort', { scoreUnit: 'load', movement: 'Deadlift' })
    const a = await submit(MEMBER, id, { result: '100' }, 'kg')
    await submit(OTHER, id, { result: '225' }, 'lbs')
    await submit(EXPIRED, id, { result: '220' }, 'lbs')
    expect(a).toMatchObject({ result: '100', weight_unit: 'kg', format_snapshot: 'Max Effort', format_config_snapshot: { scoreUnit: 'load', movement: 'Deadlift' } })
    const api = memberApi(MEMBER)
    const event = await api.fetchEvent(G1, id)
    const attempts = await api.fetchAttempts(G1, id)
    const ranked = rankEventLeaderboard(event, attempts, await api.fetchMembersByIds(attempts.map((x) => x.member_id)), { division: 'rx' })
    expect(ranked.map((r) => [r.attempt.result, r.attempt.weight_unit])).toEqual([['225', 'lb'], ['100', 'kg'], ['220', 'lb']])
  })

  it('LOAD via the member UI in lb', async () => {
    const id = createPublished('Max Clean', 'Max Effort', { scoreUnit: 'load' })
    await memberApi(OTHER).joinEvent(id, 'rx')
    render(<EventsScreen gymId={G1} memberId={OTHER} version={0} eventId={id} onOpenEvent={() => {}} showToast={vi.fn()} memberWeightUnit="lbs" lang="en" t={{}} api={memberApi(OTHER)} />)
    expect(await screen.findByText('Score: Load (kg/lb)')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '185' } })
    fireEvent.blur(screen.getByLabelText('Result'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    expect(await screen.findByText('1/20 attempts used')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /Leaderboard RX/ })).toHaveTextContent('185 lb')
  })

  it('DISTANCE km ranked in metres', async () => {
    const id = createPublished('Max Row 20 min', 'Max Effort', { scoreUnit: 'distance_km' })
    await submit(MEMBER, id, { result: '5.2' })
    await submit(OTHER, id, { result: '5.25' })
    const api = memberApi(MEMBER)
    const ranked = rankEventLeaderboard(await api.fetchEvent(G1, id), await api.fetchAttempts(G1, id), {}, { division: 'rx' })
    expect(ranked.map((r) => r.attempt.result)).toEqual(['5.25', '5.2'])
  })

  it('Once: finished beats capped total reps', async () => {
    const id = createPublished('Once Through', 'Once', { timeCapSec: 900 })
    await submit(MEMBER, id, { partialReps: ['140'] })
    await submit(OTHER, id, { time: '13:20' })
    const api = memberApi(MEMBER)
    const attempts = await api.fetchAttempts(G1, id)
    expect(attempts.find((x) => x.member_id === MEMBER)).toMatchObject({ result: '140 reps', completion_state: 'capped', format_snapshot: 'Once' })
    const ranked = rankEventLeaderboard(await api.fetchEvent(G1, id), attempts, {}, { division: 'rx' })
    expect(ranked.map((r) => r.attempt.member_id)).toEqual([OTHER, MEMBER])
  })

  it('misconfigured Max Effort (no score type) cannot even be created any more (Phase 3.2 CHECK)', () => {
    // The member UI's own fail-safe for such an event stays covered by EventsScreen.test.jsx.
    expect(() => createPublished('Legacy Max', 'Max Effort', {})).toThrow('events_max_effort_score_unit')
  })

  it('a direct RPC submission of an invalid Max Effort score is refused server-side (Phase 3.2 trigger)', async () => {
    const id = createPublished('Max Reps Pull-ups', 'Max Effort', { scoreUnit: 'reps' })
    await memberApi(MEMBER).joinEvent(id, 'rx')
    await expect(memberApi(MEMBER).submitAttempt(id, newClientAttemptId(), { result: '12.5' })).rejects.toThrow('invalid_score_for_format')
    await expect(memberApi(MEMBER).submitAttempt(id, newClientAttemptId(), { result: '12', weight_unit: 'kg' })).rejects.toThrow('invalid_score_for_format')
    expect((await memberApi(MEMBER).fetchAttempts(G1, id))).toHaveLength(0)
  })
}, 300000)
