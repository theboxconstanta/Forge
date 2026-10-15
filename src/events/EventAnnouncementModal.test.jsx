import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EventAnnouncementModal } from './EventAnnouncementModal'

const a = (p = {}) => ({
  id: 'e1', announcement_revision: 2, event_type: 'Competition', title: 'Autumn Throwdown', description: 'Heats all day.',
  cover_path: 'g/e1/c.jpg', location: 'Box C15', starts_at: '2026-11-07T08:00:00Z', ends_at: '2026-11-07T14:00:00Z',
  has_workout: true, workout_format: 'For Time', registration_enabled: true, is_registered: false, ...p,
})
const api = (divisions = ['rx']) => ({
  fetchEvent: vi.fn(async () => ({ id: 'e1', divisions })),
  coverUrl: (p) => (p ? `https://cdn.test/${p}` : null),
})
const renderModal = (props = {}) => {
  const handlers = { onJoin: vi.fn(), onLater: vi.fn(), onView: vi.fn() }
  render(<EventAnnouncementModal announcement={a()} gymId="g" total={1} working={false} error={null} joinedAwaitingAck={false} lang="en" api={api()} {...handlers} {...props} />)
  return handlers
}

describe('EventAnnouncementModal', () => {
  it('is an accessible dialog with cover, title, details and the two actions', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Autumn Throwdown' })).toBeInTheDocument()
    expect(document.querySelector('img').getAttribute('src')).toBe('https://cdn.test/g/e1/c.jpg')
    expect(screen.getByText('Box C15')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JOIN EVENT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MAYBE LATER' })).toBeInTheDocument()
  })

  it('JOIN with a division choice when the event has several', async () => {
    const h = renderModal({ api: api(['rx', 'beginner']) })
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'beginner' } })
    fireEvent.click(screen.getByRole('button', { name: 'JOIN EVENT' }))
    expect(h.onJoin).toHaveBeenCalledWith('beginner')
  })

  it('single division: JOIN sends it, no picker', async () => {
    const h = renderModal()
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    await waitFor(() => { fireEvent.click(screen.getByRole('button', { name: 'JOIN EVENT' })); expect(h.onJoin).toHaveBeenLastCalledWith('rx') })
  })

  it('MAYBE LATER and Escape both dismiss; a backdrop tap does nothing', () => {
    const h = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'MAYBE LATER' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(h.onLater).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(h.onLater).toHaveBeenCalledTimes(2)
  })

  it('buttons are disabled while working (no double submit)', () => {
    renderModal({ working: true })
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'MAYBE LATER' })).toBeDisabled()
  })

  it('already registered -> GOT IT; registration-less -> VIEW EVENT', () => {
    const { unmount } = render(<EventAnnouncementModal announcement={a({ is_registered: true })} gymId="g" total={1} lang="en" api={api()} onJoin={vi.fn()} onLater={vi.fn()} onView={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'GOT IT' })).toBeInTheDocument()
    expect(screen.getByText("You're already registered for this event.")).toBeInTheDocument()
    unmount()
    const onView = vi.fn()
    render(<EventAnnouncementModal announcement={a({ registration_enabled: false })} gymId="g" total={1} lang="en" api={api()} onJoin={vi.fn()} onLater={vi.fn()} onView={onView} />)
    fireEvent.click(screen.getByRole('button', { name: 'VIEW EVENT' }))
    expect(onView).toHaveBeenCalled()
  })

  it('shows the server error (e.g. full) and the queue position', () => {
    renderModal({ error: 'event_full', total: 3 })
    expect(screen.getByRole('alert')).toHaveTextContent('This event is full.')
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })
})
