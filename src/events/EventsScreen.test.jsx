import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import EventsScreen from './EventsScreen'

const NOW = Date.now()
const h = (hours) => new Date(NOW + hours * 3600_000).toISOString()
const ME = 'me'

const baseEvent = (p = {}) => ({
  id: 'e1', gym_id: 'g', event_type: 'Competition', title: 'Autumn Throwdown', description: 'Heats all day.', location: 'Box C15',
  cover_path: null, starts_at: h(48), ends_at: h(56), status: 'published', registration_enabled: true, capacity: 10,
  registration_deadline: null, participants_visible: true, has_workout: false, workout_format: null, workout_format_config: null,
  workout_description: null, workout_standards: null, scoring_enabled: false, leaderboard_visible: true, divisions: ['rx'],
  announcement_revision: 1, ...p,
})
const mission = (p = {}) => baseEvent({
  id: 'm1', title: 'October Mission', event_type: 'Mission of the Month', starts_at: h(-24), ends_at: h(240), capacity: null,
  has_workout: true, scoring_enabled: true, workout_format: 'AMRAP', workout_format_config: { durationSec: 720 },
  workout_description: 'AMRAP 12\n5 Pull-ups\n10 Push-ups', divisions: ['rx', 'beginner'], ...p,
})

function makeApi(over = {}) {
  const state = { events: [baseEvent(), mission()], regs: [], counts: { e1: 3, m1: 0 }, attempts: [], participants: [] }
  const api = {
    state,
    fetchMemberEvents: vi.fn(async () => state.events),
    fetchEvent: vi.fn(async (_g, id) => state.events.find((e) => e.id === id) || null),
    fetchMyRegistrations: vi.fn(async () => state.regs),
    fetchRegistrationCounts: vi.fn(async (ids) => Object.fromEntries(ids.map((id) => [id, state.counts[id] || 0]))),
    fetchParticipants: vi.fn(async () => state.participants),
    fetchAttempts: vi.fn(async () => state.attempts),
    fetchMembersByIds: vi.fn(async (ids) => Object.fromEntries(ids.map((id) => [id, { id, full_name: id === ME ? 'Me Myself' : `Member ${id}`, gender: id === 'w' ? 'feminin' : id === 'm' ? 'masculin' : null }]))),
    joinEvent: vi.fn(async (eventId, division) => { state.regs = [{ event_id: eventId, member_id: ME, status: 'registered', division: division || 'rx' }]; return { status: 'registered' } }),
    leaveEvent: vi.fn(async () => { state.regs = []; return { status: 'withdrawn' } }),
    submitAttempt: vi.fn(async (eventId, cid, fields) => {
      const row = { id: `att-${state.attempts.length + 1}`, event_id: eventId, member_id: ME, client_attempt_id: cid, division: 'rx', format_snapshot: 'AMRAP', format_config_snapshot: {}, created_at: new Date().toISOString(), scored_at: new Date().toISOString(), deleted_at: null, ...fields }
      state.attempts = [...state.attempts, row]
      return row
    }),
    updateAttempt: vi.fn(async (id, fields) => { state.attempts = state.attempts.map((a) => (a.id === id ? { ...a, ...fields } : a)); return {} }),
    deleteAttempt: vi.fn(async (id) => { state.attempts = state.attempts.map((a) => (a.id === id ? { ...a, deleted_at: new Date().toISOString() } : a)); return {} }),
    coverUrl: (p) => (p ? `https://cdn.test/${p}` : null),
    ...over,
  }
  return api
}

const renderScreen = (api, props = {}) => render(
  <EventsScreen gymId="g" memberId={ME} version={0} eventId={null} onOpenEvent={() => {}} showToast={vi.fn()} memberWeightUnit="kg" lang="en" t={{}} api={api} {...props} />,
)

beforeEach(() => localStorage.clear())

describe('Events list', () => {
  it('loading skeleton, then the four tabs with counts', async () => {
    const api = makeApi()
    renderScreen(api)
    expect(screen.getByRole('status', { name: 'loading' })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: /Upcoming · 1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Active challenges · 1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'My events' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Past' })).toBeInTheDocument()
  })

  it('cards show status, capacity and remaining places; tapping opens the event', async () => {
    const api = makeApi()
    const onOpen = vi.fn()
    renderScreen(api, { onOpenEvent: onOpen })
    const card = await screen.findByRole('button', { name: /Autumn Throwdown/ })
    expect(within(card).getByText('Upcoming')).toBeInTheDocument()
    expect(within(card).getByText('3 going · 7 places left')).toBeInTheDocument()
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith('e1')
  })

  it('empty state per tab', async () => {
    const api = makeApi()
    renderScreen(api)
    fireEvent.click(await screen.findByRole('tab', { name: 'My events' }))
    expect(screen.getByText("You haven't joined any events.")).toBeInTheDocument()
  })

  it('error with retry', async () => {
    const api = makeApi()
    api.fetchMemberEvents.mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScreen(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('tab', { name: /Upcoming · 1/ })).toBeInTheDocument()
  })

  it('a version bump (Realtime / reconnect) refetches without a manual reload', async () => {
    const api = makeApi()
    const { rerender } = renderScreen(api)
    await screen.findByRole('tab', { name: /Upcoming · 1/ })
    api.state.events = [...api.state.events, baseEvent({ id: 'e2', title: 'Beach WOD', starts_at: h(72), ends_at: h(74) })]
    rerender(<EventsScreen gymId="g" memberId={ME} version={1} eventId={null} onOpenEvent={() => {}} lang="en" t={{}} api={api} memberWeightUnit="kg" />)
    expect(await screen.findByRole('tab', { name: /Upcoming · 2/ })).toBeInTheDocument()
  })
})

describe('Registration', () => {
  it('Join: server-confirmed only (no optimistic state), double tap sends one request', async () => {
    const api = makeApi()
    let release
    api.joinEvent.mockImplementationOnce((eventId) => new Promise((r) => { release = () => { api.state.regs = [{ event_id: eventId, member_id: ME, status: 'registered', division: 'rx' }]; r({}) } }))
    renderScreen(api, { eventId: 'e1' })
    const join = await screen.findByRole('button', { name: 'Join event' })
    fireEvent.click(join)
    fireEvent.click(join)
    expect(await screen.findByRole('button', { name: 'Joining…' })).toBeDisabled()
    expect(screen.queryByText(/You're registered/)).not.toBeInTheDocument()
    await act(async () => release())
    expect(await screen.findByText("You're registered · RX")).toBeInTheDocument()
    expect(api.joinEvent).toHaveBeenCalledTimes(1)
    expect(api.joinEvent).toHaveBeenCalledWith('e1', 'rx')
  })

  it('division selection when the event has several', async () => {
    const api = makeApi()
    api.state.events[0] = baseEvent({ divisions: ['rx', 'beginner'] })
    renderScreen(api, { eventId: 'e1' })
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'beginner' } })
    expect(screen.getByRole('option', { name: 'Scaled' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Join event' }))
    await waitFor(() => expect(api.joinEvent).toHaveBeenCalledWith('e1', 'beginner'))
  })

  it('server refusal (full) is shown and nothing changes', async () => {
    const api = makeApi({ joinEvent: vi.fn().mockRejectedValue(new Error('event_full')) })
    renderScreen(api, { eventId: 'e1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Join event' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This event is full.')
    expect(screen.queryByText(/You're registered/)).not.toBeInTheDocument()
  })

  it('full / closed events offer no join', async () => {
    const api = makeApi()
    api.state.counts.e1 = 10
    renderScreen(api, { eventId: 'e1' })
    expect(await screen.findByRole('button', { name: 'Full' })).toBeDisabled()
  })

  it('Leave asks for confirmation, then calls event_leave', async () => {
    const api = makeApi()
    api.state.regs = [{ event_id: 'e1', member_id: ME, status: 'registered', division: 'rx' }]
    renderScreen(api, { eventId: 'e1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Leave event' }))
    expect(api.leaveEvent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, leave' }))
    await waitFor(() => expect(api.leaveEvent).toHaveBeenCalledWith('e1'))
    expect(await screen.findByRole('button', { name: 'Join event' })).toBeInTheDocument()
  })

  it('cancelled events: status shown, no registration controls', async () => {
    const api = makeApi()
    api.state.events[0] = baseEvent({ status: 'cancelled' })
    renderScreen(api, { eventId: 'e1' })
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join event' })).not.toBeInTheDocument()
  })

  it('divisions hidden by staff: no picker, Join sends no division, no division labels anywhere', async () => {
    const api = makeApi()
    api.state.events[0] = baseEvent({ divisions: ['rx', 'intermediate', 'beginner', 'onramp'], member_division_choice: false })
    api.state.participants = [{ member_id: 'x', division: 'beginner', status: 'registered' }]
    renderScreen(api, { eventId: 'e1' })
    const join = await screen.findByRole('button', { name: 'Join event' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Choose your division')).not.toBeInTheDocument()
    fireEvent.click(join)
    await waitFor(() => expect(api.joinEvent).toHaveBeenCalledWith('e1', null))
    expect(await screen.findByText("You're registered")).toBeInTheDocument()
    expect(screen.queryByText(/You're registered ·/)).not.toBeInTheDocument()
    expect(await screen.findByText('Member x')).toBeInTheDocument()
    expect(screen.queryByText('Scaled')).not.toBeInTheDocument()
    expect(screen.queryByText('RX')).not.toBeInTheDocument()
  })

  it('divisions explicitly shown: picker and labels exactly as before', async () => {
    const api = makeApi()
    api.state.events[0] = baseEvent({ divisions: ['rx', 'beginner'], member_division_choice: true })
    api.state.participants = [{ member_id: 'x', division: 'beginner', status: 'registered' }]
    renderScreen(api, { eventId: 'e1' })
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
    expect(await screen.findByText('Scaled', { selector: 'span' })).toBeInTheDocument()
  })

  it('private participant list shows only the count', async () => {
    const api = makeApi()
    api.state.events[0] = baseEvent({ participants_visible: false })
    renderScreen(api, { eventId: 'e1' })
    expect(await screen.findByText('The participant list is private.')).toBeInTheDocument()
  })
})

describe('Mission of the Month - attempts', () => {
  const registered = (api) => { api.state.regs = [{ event_id: 'm1', member_id: ME, status: 'registered', division: 'rx' }] }

  it('submit uses a fresh client_attempt_id per NEW attempt; history + best update without reload', async () => {
    const api = makeApi()
    registered(api)
    renderScreen(api, { eventId: 'm1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Additional reps'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledTimes(1))
    const [eventId, cid1, fields] = api.submitAttempt.mock.calls[0]
    expect(eventId).toBe('m1')
    expect(fields).toMatchObject({ result: '7 runde + 12', time_result: null, completion_state: null })
    expect(fields).not.toHaveProperty('division')
    expect(await screen.findByText('1/20 attempts used')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add an attempt' }))
    fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledTimes(2))
    expect(api.submitAttempt.mock.calls[1][1]).not.toBe(cid1)
    // the better attempt carries the Best marker (attempt list + leaderboard both show 8 rounds)
    const attempts = screen.getByRole('region', { name: 'Your attempts' })
    const best = within(attempts).getByText('Best').closest('li')
    expect(best).toHaveTextContent('8 rounds')
  })

  it('submit stays disabled until a score is entered', async () => {
    const api = makeApi()
    registered(api)
    renderScreen(api, { eventId: 'm1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    expect(screen.getByRole('button', { name: 'Submit score' })).toBeDisabled()
  })

  it('unknown outcome: the retry reuses the SAME client_attempt_id', async () => {
    const api = makeApi()
    registered(api)
    const realSubmit = api.submitAttempt.getMockImplementation()
    api.submitAttempt.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    renderScreen(api, { eventId: 'm1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    expect(await screen.findByText("A previous submission wasn't confirmed.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an attempt' })).not.toBeInTheDocument()
    api.submitAttempt.mockImplementation(realSubmit)
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledTimes(2))
    expect(api.submitAttempt.mock.calls[1][1]).toBe(api.submitAttempt.mock.calls[0][1])
    await waitFor(() => expect(screen.queryByText("A previous submission wasn't confirmed.")).not.toBeInTheDocument())
  })

  it('edit sends event_update_attempt with recomposed fields; delete is confirmed and soft', async () => {
    const api = makeApi()
    registered(api)
    api.state.attempts = [{ id: 'att-1', event_id: 'm1', member_id: ME, division: 'rx', result: '6 runde + 3', time_result: null, completion_state: null, format_snapshot: 'AMRAP', format_config_snapshot: {}, created_at: h(-2), scored_at: h(-2), deleted_at: null }]
    renderScreen(api, { eventId: 'm1' })
    fireEvent.click(await screen.findByRole('button', { name: /^Edit 6 rounds \+ 3/ }))
    expect(screen.getByLabelText('Rounds completed')).toHaveValue('6')
    fireEvent.change(screen.getByLabelText('Additional reps'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateAttempt).toHaveBeenCalledWith('att-1', expect.objectContaining({ result: '6 runde + 9' })))

    fireEvent.click(await screen.findByRole('button', { name: /^Delete 6 rounds \+ 9/ }))
    expect(api.deleteAttempt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(api.deleteAttempt).toHaveBeenCalledWith('att-1'))
    expect(await screen.findByText('Deleted')).toBeInTheDocument()
    // a deleted attempt still counts towards the limit
    expect(screen.getByText('1/20 attempts used')).toBeInTheDocument()
  })

  it('20 attempts (deleted included) -> no more attempts offered', async () => {
    const api = makeApi()
    registered(api)
    api.state.attempts = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, event_id: 'm1', member_id: ME, division: 'rx', result: `${i} runde complete`, format_snapshot: 'AMRAP', format_config_snapshot: {}, created_at: h(-30 + i), scored_at: h(-30 + i), deleted_at: i < 5 ? h(-1) : null }))
    renderScreen(api, { eventId: 'm1' })
    expect(await screen.findByText('20/20 attempts used')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an attempt' })).not.toBeInTheDocument()
  })

  it('not registered: scoring asks to join first', async () => {
    const api = makeApi()
    renderScreen(api, { eventId: 'm1' })
    expect(await screen.findByText('Join the event to submit scores.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an attempt' })).not.toBeInTheDocument()
  })

  it('leaderboard: best per member, division + gender filters, refreshes on new data', async () => {
    const api = makeApi()
    registered(api)
    const a = (id, member_id, result, division = 'rx') => ({ id, event_id: 'm1', member_id, division, result, time_result: null, completion_state: null, format_snapshot: 'AMRAP', format_config_snapshot: {}, created_at: h(-5), scored_at: h(-5), deleted_at: null })
    api.state.attempts = [a('1', 'w', '9 runde complete'), a('2', 'm', '10 runde complete'), a('3', 'w', '11 runde + 2'), a('4', 's', '12 runde complete', 'beginner')]
    const { rerender } = renderScreen(api, { eventId: 'm1' })
    const board = await screen.findByRole('region', { name: 'Leaderboard' })
    const rows = () => within(within(board).getByRole('list', { name: /Leaderboard RX/ })).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toMatch(/Member w.*11 rounds \+ 2/)
    fireEvent.click(within(board).getByRole('button', { name: 'Men' }))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatch(/Member m/)
    fireEvent.click(within(board).getByRole('button', { name: 'All' }))
    fireEvent.click(within(board).getByRole('tab', { name: 'Scaled' }))
    expect(within(board).getByRole('list', { name: /Leaderboard Scaled/ })).toHaveTextContent('Member s')
    // another member scores -> Realtime version bump -> refreshed leaderboard
    fireEvent.click(within(board).getByRole('tab', { name: 'RX' }))
    api.state.attempts = [...api.state.attempts, a('5', 'x', '20 runde complete')]
    rerender(<EventsScreen gymId="g" memberId={ME} version={1} eventId="m1" onOpenEvent={() => {}} lang="en" t={{}} api={api} memberWeightUnit="kg" />)
    await waitFor(() => expect(rows()[0]).toMatch(/Member x.*20 rounds/))
  })
})

describe('Max Effort score types', () => {
  const maxEffort = (cfg) => mission({ id: 'me1', title: 'Max Deadlift', workout_format: 'Max Effort', workout_format_config: cfg, divisions: ['rx'] })
  const setup = (cfg, unit = 'kg') => {
    const api = makeApi()
    api.state.events = [maxEffort(cfg)]
    api.state.regs = [{ event_id: 'me1', member_id: ME, status: 'registered', division: 'rx' }]
    renderScreen(api, { eventId: 'me1', memberWeightUnit: unit })
    return api
  }

  it('missing score type: clear warning, no way to submit (never free text)', async () => {
    setup({})
    expect(await screen.findByText(/score type isn't set up yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an attempt' })).not.toBeInTheDocument()
  })

  it('LOAD in lb: lb input, stored with weight_unit lb, shown on the workout card', async () => {
    const api = setup({ scoreUnit: 'load' }, 'lbs')
    expect(await screen.findByText('Score: Load (kg/lb)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add an attempt' }))
    expect(screen.getByText('lb')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '315' } })
    fireEvent.blur(screen.getByLabelText('Result'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled())
    expect(api.submitAttempt.mock.calls[0][2]).toMatchObject({ result: '315', weight_unit: 'lb' })
  })

  it('DISTANCE km: km input and unit on the result', async () => {
    const api = setup({ scoreUnit: 'distance_km' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add an attempt' }))
    expect(screen.getByText('km')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '5.2' } })
    fireEvent.blur(screen.getByLabelText('Result'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit score' }))
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled())
    expect(api.submitAttempt.mock.calls[0][2]).toMatchObject({ result: '5.2', weight_unit: null })
  })
})
