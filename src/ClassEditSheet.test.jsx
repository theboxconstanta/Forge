import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import ClassEditSheet from './ClassEditSheet'
import { getT } from './translations'

afterEach(() => cleanup())

const t = getT('en')
const NOW = new Date('2026-10-08T12:00:00')
const series = { id: 'c1', name: 'CrossFit', date: '2026-10-15', start_time: '09:00:00', end_time: '10:00:00', coach: 'Ana', max_spots: 12, color: null, series_id: 's1', series_exception: false }
const oneOff = { ...series, id: 'c2', series_id: null }

function setup(cls = series, rpcImpl, extra = {}) {
  const rpc = vi.fn(rpcImpl || (async (_fn, args) => ({ data: { affected: args.p_scope === 'this' ? 1 : 7, first_date: '2026-10-15', last_date: '2026-11-26', booked_total: 5, booked_max: 3, skipped_exceptions: 1, preserved_past: 2, ids: [] }, error: null })))
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<ClassEditSheet cls={cls} t={t} lang="en" supabase={{ rpc }} onClose={onClose} onSaved={onSaved} now={NOW} {...extra} />)
  return { rpc, onClose, onSaved }
}
const nameInput = () => screen.getByLabelText('Class name')

describe('ClassEditSheet', () => {
  it('opens prefilled with the current class values', () => {
    setup()
    expect(screen.getByText('Edit Class')).toBeInTheDocument()
    expect(nameInput()).toHaveValue('CrossFit')
    expect(screen.getByLabelText(t.adminClassStartTimeLabel)).toHaveValue('09:00')
    expect(screen.getByLabelText(t.adminClassEndTimeLabel)).toHaveValue('10:00')
    expect(screen.getByLabelText(t.adminClassCoachLabel)).toHaveValue('Ana')
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('series occurrence: three scopes, default "This class only"', () => {
    setup()
    expect(screen.getByLabelText(/This class only/)).toBeChecked()
    expect(screen.getByLabelText(/This and future classes/)).not.toBeChecked()
    expect(screen.getByLabelText(/Entire series/)).not.toBeChecked()
  })

  it('one-off class: no recurring options, explanatory note', () => {
    setup(oneOff)
    expect(screen.getByLabelText(/This class only/)).toBeChecked()
    expect(screen.queryByLabelText(/This and future classes/)).toBeNull()
    expect(screen.queryByLabelText(/Entire series/)).toBeNull()
    expect(screen.getByText(t.adminClassEditOneOffNote)).toBeInTheDocument()
  })

  it('ended occurrence: only "This class only"', () => {
    setup({ ...series, date: '2026-10-01' })
    expect(screen.queryByLabelText(/Entire series/)).toBeNull()
    expect(screen.getByText(t.adminClassEditEndedNote)).toBeInTheDocument()
  })

  it('Cancel closes without any database call', () => {
    const { rpc, onClose } = setup()
    fireEvent.change(nameInput(), { target: { value: 'Strength' } })
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('Save with no changes: message, no database call', () => {
    const { rpc, onSaved } = setup()
    fireEvent.click(screen.getByText('Save Changes'))
    expect(screen.getByRole('alert')).toHaveTextContent(t.adminClassEditNoChanges)
    expect(rpc).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('This class only: one real write with only the changed field', async () => {
    const { rpc, onSaved } = setup()
    fireEvent.change(nameInput(), { target: { value: 'Strength' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_class_id: 'c1', p_scope: 'this', p_changes: { name: 'Strength' }, p_dry_run: false })
  })

  it('This and future: server dry run -> confirmation with real count -> apply', async () => {
    const { rpc, onSaved } = setup()
    fireEvent.change(screen.getByLabelText(t.adminClassCoachLabel), { target: { value: 'Bob' } })
    fireEvent.click(screen.getByLabelText(/This and future classes/))
    fireEvent.click(screen.getByText('Save Changes'))
    await screen.findByText(t.adminClassEditConfirmTitle)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_scope: 'future', p_dry_run: true, p_changes: { coach: 'Bob' } })
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByText('Coach: Ana → Bob')).toBeInTheDocument()
    expect(screen.getByText(t.adminClassEditConfirmBookingsKept(5))).toBeInTheDocument()
    expect(screen.getByText(t.adminClassEditConfirmSkipped(1))).toBeInTheDocument()
    expect(screen.getByText(t.adminClassEditConfirmPast(2))).toBeInTheDocument()
    fireEvent.click(screen.getByText('Apply to 7 classes'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_scope: 'future', p_dry_run: false })
  })

  it('time change on booked classes warns that members will see the new time', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(t.adminClassStartTimeLabel), { target: { value: '09:30' } })
    fireEvent.change(screen.getByLabelText(t.adminClassEndTimeLabel), { target: { value: '10:30' } })
    fireEvent.click(screen.getByLabelText(/Entire series/))
    fireEvent.click(screen.getByText('Save Changes'))
    await screen.findByText(t.adminClassEditConfirmTimeWarning)
  })

  it('Back from confirmation returns to the form without writing', async () => {
    const { rpc, onSaved } = setup()
    fireEvent.change(nameInput(), { target: { value: 'Functional Fitness' } })
    fireEvent.click(screen.getByLabelText(/Entire series/))
    fireEvent.click(screen.getByText('Save Changes'))
    await screen.findByText(t.adminClassEditConfirmTitle)
    fireEvent.click(screen.getByText('Back'))
    expect(nameInput()).toHaveValue('Functional Fitness')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('capacity below known bookings is blocked before any call', () => {
    const { rpc } = setup(series, undefined, { bookedCount: 12 })
    fireEvent.click(screen.getByLabelText('Decrease capacity'))
    fireEvent.click(screen.getByText('Save Changes'))
    expect(screen.getByRole('alert')).toHaveTextContent('already has 12 bookings')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('end time before start time is blocked before any call', () => {
    const { rpc } = setup()
    fireEvent.change(screen.getByLabelText(t.adminClassEndTimeLabel), { target: { value: '08:00' } })
    fireEvent.click(screen.getByText('Save Changes'))
    expect(screen.getByRole('alert')).toHaveTextContent(t.adminClassEditErrorTime)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a database rejection shows the error and never reports success', async () => {
    const { onSaved } = setup(series, async () => ({ data: null, error: { message: 'capacity_below_bookings', details: '[{"date":"2026-10-22","booked":9}]' } }))
    fireEvent.click(screen.getByLabelText('Decrease capacity'))
    fireEvent.click(screen.getByText('Save Changes'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No class was changed')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('concurrent edit from another session is reported, not overwritten', async () => {
    const { onSaved } = setup(series, async () => ({ data: null, error: { message: 'class_changed_concurrently' } }))
    fireEvent.change(nameInput(), { target: { value: 'Strength' } })
    fireEvent.click(screen.getByText('Save Changes'))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.adminClassEditErrConcurrent)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('scope radios and buttons are keyboard-reachable native controls', () => {
    setup()
    for (const el of screen.getAllByRole('radio', { name: /class|series/i })) expect(el.tagName).toBe('INPUT')
    expect(screen.getByText('Save Changes').tagName).toBe('BUTTON')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
