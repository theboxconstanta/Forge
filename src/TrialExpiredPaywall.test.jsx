import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TrialExpiredPaywall from './TrialExpiredPaywall'
import { T_EN } from './translations'

// M10.8 Trial Expiry Enforcement - the hard-paywall screen. Whether it is
// ever rendered at all is decided entirely by App.jsx reading is_gym_
// access_blocked()'s own return value (verified exhaustively at the SQL
// layer against every OWNER_LIFECYCLE_STATE_MACHINE.md Section 6
// combination cell) - these tests only cover this component's own two
// branches (Owner vs non-Owner), not the blocking decision itself.

// PlatformBilling.jsx is embedded directly for the Owner branch (real
// reuse, not a stub) - its own query chain (eq/is/neq/limit/maybeSingle,
// and a thenable for the no-active-subscription path) needs a mock at
// least as complete as PlatformBilling.test.jsx's own, so this test
// exercises the actual embedding, not a mock mismatch.
vi.mock('./supabase.js', () => {
  const chain = () => {
    const c = {
      select: () => c,
      eq: () => c,
      is: () => c,
      neq: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
    }
    return c
  }
  return {
    supabase: {
      from: () => chain(),
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
      rpc: () => Promise.resolve({ error: null }),
    },
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TrialExpiredPaywall', () => {
  it('shows the Owner reactivation path (embeds the real M10.5 purchase flow), never a dead-end message', async () => {
    render(<TrialExpiredPaywall isOwner={true} gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    expect(screen.getByText('Your trial has ended')).toBeInTheDocument()
    expect(screen.getByText(/14-day free trial has ended/)).toBeInTheDocument()
    expect(screen.queryByText('Contact the gym owner to reactivate access.')).not.toBeInTheDocument()
  })

  it('shows the non-Owner contact-the-owner message, with no purchase action they cannot actually perform', async () => {
    render(<TrialExpiredPaywall isOwner={false} gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    expect(screen.getByText('Your trial has ended')).toBeInTheDocument()
    expect(screen.getByText(/gym owner reactivates/)).toBeInTheDocument()
    expect(screen.getByText('Contact the gym owner to reactivate access.')).toBeInTheDocument()
  })
})
