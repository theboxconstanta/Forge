import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ActivationDashboard from './ActivationDashboard'
import { T_EN } from './translations'

// M10.2 - Activation Dashboard. Covers the scenarios the implementation
// mission explicitly listed: brand-new Owner (full checklist), post-First-
// Value (lighter panel), post-Activation (renders nothing), the invite-
// blocked-until-waiver dependency, and the self-preview hint's presence
// (never claiming to satisfy First Value).

let queryData = {}

vi.mock('./supabase.js', () => {
  const chain = (table) => {
    const c = {
      select: () => c,
      eq: () => c,
      lte: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: queryData[table] ?? null, error: null }),
    }
    return c
  }
  return {
    supabase: {
      from: (table) => chain(table),
      channel: () => ({ on: function () { return this }, subscribe: function () { return this } }),
      removeChannel: vi.fn(),
      auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
    },
  }
})

function jsonResponse(json, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => json }
}

const baseProps = { gymId: 'gym-1', gymName: 'CrossFit Test', t: T_EN, lang: 'en', showToast: vi.fn() }

beforeEach(() => {
  queryData = {}
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ActivationDashboard - pre-First-Value (brand-new Owner)', () => {
  it('shows the confirmation header and both required actions, with invite blocked until the waiver is confirmed', async () => {
    queryData.gym_activation_state = { activation_state: 'onboarding' }
    queryData.gym_commercial_state = { trial_ends_at: new Date(Date.now() + 10 * 86400000).toISOString() }
    queryData.gym_waivers = null // no current waiver yet

    render(<ActivationDashboard {...baseProps} />)

    await waitFor(() => expect(screen.getByText(/CrossFit Test/)).toBeInTheDocument())
    expect(screen.getByText('Confirm your gym rules')).toBeInTheDocument()
    expect(screen.getByText('Invite your first member')).toBeInTheDocument()
    // Dependency shown inline, not silently enforced - the reason is visible text.
    expect(screen.getByText('Confirm your gym rules first.')).toBeInTheDocument()
    // No email input should be rendered yet since the invite action is blocked.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('unblocks the invite action once a current waiver already exists, and shows the self-preview hint without ever claiming it satisfies First Value', async () => {
    queryData.gym_activation_state = { activation_state: 'onboarding' }
    queryData.gym_commercial_state = { trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString() }
    queryData.gym_waivers = { id: 'waiver-1' } // already confirmed

    render(<ActivationDashboard {...baseProps} />)

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(screen.getByText(/Nobody to invite yet\?/)).toBeInTheDocument()
    expect(screen.getByText(/see exactly what a member will see/)).toBeInTheDocument()
  })

  it('collapses optional setup items behind a single closed-by-default disclosure', async () => {
    queryData.gym_activation_state = { activation_state: 'unverified' }
    queryData.gym_commercial_state = { trial_ends_at: null }
    queryData.gym_waivers = null

    render(<ActivationDashboard {...baseProps} />)
    await waitFor(() => expect(screen.getByText('Optional setup (you can do this anytime)')).toBeInTheDocument())

    // Closed by default - the individual optional items are not yet in the document.
    expect(screen.queryByText('Upload your gym logo')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Optional setup (you can do this anytime)'))
    expect(screen.getByText('Upload your gym logo')).toBeInTheDocument()
    expect(screen.getByText('Connect online payments for members')).toBeInTheDocument()
  })

  it('publishing the waiver calls admin-manage-waiver and unblocks the invite action', async () => {
    queryData.gym_activation_state = { activation_state: 'onboarding' }
    queryData.gym_commercial_state = { trial_ends_at: null }
    queryData.gym_waivers = null
    let publishedBody = null
    globalThis.fetch = vi.fn((url, opts) => {
      publishedBody = JSON.parse(opts.body)
      return Promise.resolve(jsonResponse({ success: true, id: 'w1', version: '1', effective_date: '2026-08-02', immediate: true }))
    })

    render(<ActivationDashboard {...baseProps} />)
    await waitFor(() => expect(screen.getByText('Review & publish')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Review & publish'))

    await waitFor(() => expect(screen.getByText('Publish waiver')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Publish waiver'))

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(publishedBody.action).toBe('publish')
    expect(publishedBody.title).toBeTruthy()
    expect(publishedBody.content).toBeTruthy()
  })

  it('M10.3 - inviting a co-admin/coach calls accept-admin-invitation with action:send, independent of the Member invite action', async () => {
    queryData.gym_activation_state = { activation_state: 'onboarding' }
    queryData.gym_commercial_state = { trial_ends_at: null }
    queryData.gym_waivers = { id: 'waiver-1' }
    let sentBody = null
    let sentUrl = null
    globalThis.fetch = vi.fn((url, opts) => {
      sentUrl = String(url)
      sentBody = JSON.parse(opts.body)
      return Promise.resolve(jsonResponse({ success: true, invitation_id: 'admin-inv-1' }))
    })

    render(<ActivationDashboard {...baseProps} />)
    await waitFor(() => expect(screen.getByText('Optional setup (you can do this anytime)')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Optional setup (you can do this anytime)'))

    const coachEmailInput = screen.getByLabelText('Invite a co-admin or coach')
    fireEvent.change(coachEmailInput, { target: { value: 'coach@example.com' } })
    fireEvent.click(screen.getByText('Invite'))

    await waitFor(() => expect(screen.getByText('✓ Admin invitation sent to coach@example.com')).toBeInTheDocument())
    expect(sentUrl).toContain('accept-admin-invitation')
    expect(sentBody.action).toBe('send')
    expect(sentBody.email).toBe('coach@example.com')
  })
})

describe('ActivationDashboard - post-First-Value, pre-Activation', () => {
  it('shows the lighter "Getting Started" panel, not the full checklist', async () => {
    queryData.gym_activation_state = { activation_state: 'first_value_reached' }
    queryData.gym_commercial_state = { trial_ends_at: null }
    queryData.gym_waivers = { id: 'waiver-1' }

    render(<ActivationDashboard {...baseProps} />)

    await waitFor(() => expect(screen.getByText('🎉 Your first member joined!')).toBeInTheDocument())
    expect(screen.queryByText('Confirm your gym rules')).not.toBeInTheDocument()
    expect(screen.queryByText('Optional setup (you can do this anytime)')).not.toBeInTheDocument()
  })
})

describe('ActivationDashboard - post-Activation', () => {
  it('renders nothing at all once activated', async () => {
    queryData.gym_activation_state = { activation_state: 'activated' }
    queryData.gym_commercial_state = { trial_ends_at: null }
    queryData.gym_waivers = { id: 'waiver-1' }

    const { container } = render(<ActivationDashboard {...baseProps} />)

    await waitFor(() => expect(container.firstChild).toBeNull())
  })
})

describe('ActivationDashboard - loading state', () => {
  it('renders nothing before the initial fetch resolves (no flash of empty UI)', () => {
    queryData.gym_activation_state = { activation_state: 'onboarding' }
    queryData.gym_commercial_state = { trial_ends_at: null }
    queryData.gym_waivers = null

    const { container } = render(<ActivationDashboard {...baseProps} />)
    expect(container.firstChild).toBeNull()
  })
})
