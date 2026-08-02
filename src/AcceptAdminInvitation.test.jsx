import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import AcceptAdminInvitation from './AcceptAdminInvitation'

// M10.3 - Admin Invitation acceptance page. Public, unauthenticated,
// structurally simpler than InviteOnboarding.jsx (no Waiver/preferences
// step, just role grant) - these tests cover the invalid-link case, the
// confirm-then-accept happy path (including the verifyOtp session
// handoff), and the session_pending fallback.

vi.mock('./supabase.js', () => ({
  supabase: { auth: { verifyOtp: vi.fn(async () => ({ error: null })) } },
}))

function mockFetchSequence(handlers) {
  globalThis.fetch = vi.fn((url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {}
    for (const [match, handler] of handlers) {
      if (String(url).includes(match)) return Promise.resolve(handler(body))
    }
    throw new Error(`Unexpected fetch to ${url}`)
  })
}
function jsonResponse(json, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => json }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AcceptAdminInvitation - invalid link', () => {
  it('shows the invalid state when invitationId or token is missing', async () => {
    window.history.pushState({}, '', '/admin-invite/inv-1')
    render(<AcceptAdminInvitation invitationId="inv-1" />)
    await waitFor(() => expect(screen.getByText('Invalid invitation')).toBeInTheDocument())
  })

  it('shows the invalid state when the status check fails', async () => {
    window.history.pushState({}, '', '/admin-invite/inv-1?t=bad-token')
    mockFetchSequence([['accept-admin-invitation', () => jsonResponse({ error: 'not found' }, false)]])
    render(<AcceptAdminInvitation invitationId="inv-1" />)
    await waitFor(() => expect(screen.getByText('Invalid invitation')).toBeInTheDocument())
  })
})

describe('AcceptAdminInvitation - accept flow', () => {
  it('shows the gym name and invited email, then accepts and establishes a session via verifyOtp', async () => {
    window.history.pushState({}, '', '/admin-invite/inv-1?t=good-token')
    let acceptedBody = null
    mockFetchSequence([
      ['accept-admin-invitation', (body) => {
        if (body.action === 'status') return jsonResponse({ gym_name: 'CrossFit Test', invited_email: 'coach@example.com' })
        if (body.action === 'accept') { acceptedBody = body; return jsonResponse({ success: true, token_hash: 'hashed-token' }) }
        throw new Error('unexpected action')
      }],
    ])
    render(<AcceptAdminInvitation invitationId="inv-1" />)

    await waitFor(() => expect(screen.getByText(/CrossFit Test/)).toBeInTheDocument())
    expect(screen.getByText(/coach@example.com/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Accept invitation'))

    await waitFor(() => expect(screen.getByText('🎉 Welcome to the team!')).toBeInTheDocument())
    expect(acceptedBody.invitation_id).toBe('inv-1')
    expect(acceptedBody.token).toBe('good-token')
    expect(screen.getByText('You now have Admin access. You can close this page and log in from the app.')).toBeInTheDocument()
  })

  it('falls back to the no-session success message when no token_hash is returned', async () => {
    window.history.pushState({}, '', '/admin-invite/inv-2?t=good-token')
    mockFetchSequence([
      ['accept-admin-invitation', (body) => {
        if (body.action === 'status') return jsonResponse({ gym_name: 'CrossFit Test', invited_email: 'coach@example.com' })
        return jsonResponse({ success: true, session_pending: true })
      }],
    ])
    render(<AcceptAdminInvitation invitationId="inv-2" />)
    await waitFor(() => expect(screen.getByText('Accept invitation')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Accept invitation'))
    await waitFor(() => expect(screen.getByText(/Log in from the app with this email/)).toBeInTheDocument())
  })

  it('shows an inline error and stays on the confirm step if accept fails', async () => {
    window.history.pushState({}, '', '/admin-invite/inv-3?t=good-token')
    mockFetchSequence([
      ['accept-admin-invitation', (body) => {
        if (body.action === 'status') return jsonResponse({ gym_name: 'CrossFit Test', invited_email: 'coach@example.com' })
        return jsonResponse({ error: 'Această invitație nu mai este validă' }, false)
      }],
    ])
    render(<AcceptAdminInvitation invitationId="inv-3" />)
    await waitFor(() => expect(screen.getByText('Accept invitation')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Accept invitation'))
    await waitFor(() => expect(screen.getByText('Această invitație nu mai este validă')).toBeInTheDocument())
    expect(screen.getByText('Accept invitation')).toBeInTheDocument()
  })
})
