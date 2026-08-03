import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PlatformBilling from './PlatformBilling'
import { T_EN } from './translations'

// M10.5 Platform Purchase Flow - Billing settings screen. Owner-only
// (gated upstream in App.jsx by isOwner, not by this component itself).
// Covers the two read states (M10.5_PRODUCT_DECISIONS.md Decision 3 -
// active Subscription shows a read-only summary, never a Buy button;
// no active Subscription shows the catalog + Buy CTA) and the purchase
// action redirecting to the URL purchase-platform-plan returns.
//
// M10.6 - Plan Upgrade/Downgrade/Cancel additions: the plan-change
// selector (upgrade vs downgrade label from price comparison, per
// OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 6.4's "UI label,
// not a different code path"), and the cancel-confirmation flow, both on
// this same existing screen - no new component, no new route.

let queryData = {}
let rpcCalls = []
let rpcError = null

vi.mock('./supabase.js', () => {
  const chain = (table) => {
    const c = {
      select: () => c,
      eq: () => c,
      is: () => c,
      neq: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: queryData[table] ?? null, error: null }),
      then: (resolve) => resolve({ data: queryData[table] ?? [], error: null }),
    }
    return c
  }
  return {
    supabase: {
      from: (table) => chain(table),
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
      rpc: (name, args) => {
        rpcCalls.push({ name, args })
        return Promise.resolve({ error: rpcError })
      },
    },
  }
})

const originalFetch = globalThis.fetch
const originalLocation = window.location

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryData = {}
  rpcCalls = []
  rpcError = null
  globalThis.fetch = originalFetch
})

describe('PlatformBilling - active subscription', () => {
  it('shows a read-only Active Plan summary, never a Buy button', async () => {
    queryData.platform_subscriptions = {
      id: 'sub1', platform_plan_version_id: 'v1', price_amount: 7900, currency: 'EUR', started_at: '2026-08-01T00:00:00Z', renews_at: '2026-09-01T00:00:00Z',
    }
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Active plan')).toBeInTheDocument())
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Buy Forge')).not.toBeInTheDocument()
  })

  it('shows no plan-change selector when no other Plan Version exists (single-tier catalog, today\'s real state)', async () => {
    queryData.platform_subscriptions = { id: 'sub1', platform_plan_version_id: 'v1', price_amount: 7900, currency: 'EUR', started_at: null, renews_at: null }
    queryData.platform_plan_versions = []
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Active plan')).toBeInTheDocument())
    expect(screen.queryByText('Change plan')).not.toBeInTheDocument()
  })

  it('offers an upgrade to a more expensive Version and calls upgrade_platform_plan on confirm', async () => {
    queryData.platform_subscriptions = { id: 'sub1', platform_plan_version_id: 'v1', price_amount: 7900, currency: 'EUR', started_at: null, renews_at: null }
    queryData.platform_plan_versions = [
      { id: 'v2', price_amount: 14900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge Pro' } },
    ]
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Switch to this plan')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Switch to this plan'))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(rpcCalls.some((c) => c.name === 'upgrade_platform_plan')).toBe(true))
    expect(rpcCalls[0]).toEqual({ name: 'upgrade_platform_plan', args: { p_gym_id: 'gym1', p_new_platform_plan_version_id: 'v2' } })
  })

  it('offers a downgrade to a cheaper Version and calls downgrade_platform_plan on confirm', async () => {
    queryData.platform_subscriptions = { id: 'sub1', platform_plan_version_id: 'v1', price_amount: 14900, currency: 'EUR', started_at: null, renews_at: null }
    queryData.platform_plan_versions = [
      { id: 'v0', price_amount: 3900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge Lite' } },
    ]
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Switch to this plan')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Switch to this plan'))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(rpcCalls.some((c) => c.name === 'downgrade_platform_plan')).toBe(true))
    expect(rpcCalls[0]).toEqual({ name: 'downgrade_platform_plan', args: { p_gym_id: 'gym1', p_new_platform_plan_version_id: 'v0' } })
  })

  it('shows a toast and does not call the RPC when a plan change fails', async () => {
    queryData.platform_subscriptions = { id: 'sub1', platform_plan_version_id: 'v1', price_amount: 7900, currency: 'EUR', started_at: null, renews_at: null }
    queryData.platform_plan_versions = [
      { id: 'v2', price_amount: 14900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge Pro' } },
    ]
    rpcError = { message: 'this gym already has an active platform subscription' }
    const showToast = vi.fn()
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={showToast} />)
    await waitFor(() => expect(screen.getByText('Switch to this plan')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Switch to this plan'))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('this gym already has an active platform subscription'))
  })

  it('cancels the subscription only after explicit confirmation, then reloads', async () => {
    queryData.platform_subscriptions = { id: 'sub1', platform_plan_version_id: 'v1', price_amount: 7900, currency: 'EUR', started_at: null, renews_at: null }
    queryData.platform_plan_versions = []
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Cancel subscription')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Cancel subscription'))
    expect(rpcCalls.length).toBe(0)
    expect(screen.getByText('Yes, cancel')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Yes, cancel'))
    await waitFor(() => expect(rpcCalls.some((c) => c.name === 'cancel_platform_subscription')).toBe(true))
    expect(rpcCalls[0]).toEqual({ name: 'cancel_platform_subscription', args: { p_gym_id: 'gym1' } })
  })
})

describe('PlatformBilling - no active subscription', () => {
  it('shows the catalog and a Buy CTA', async () => {
    queryData.platform_subscriptions = null
    queryData.platform_plan_versions = [
      { id: 'v1', price_amount: 7900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge' } },
    ]
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Buy Forge')).toBeInTheDocument())
    expect(screen.getByText('€79')).toBeInTheDocument()
  })

  it('redirects to the Stripe Checkout URL on purchase', async () => {
    queryData.platform_subscriptions = null
    queryData.platform_plan_versions = [
      { id: 'v1', price_amount: 7900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge' } },
    ]
    delete window.location
    window.location = { href: '' }
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/session/xyz' }) }))
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Buy Forge')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Buy Forge'))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/session/xyz'))
    window.location = originalLocation
  })

  it('shows a toast and re-enables the button when the purchase request fails', async () => {
    queryData.platform_subscriptions = null
    queryData.platform_plan_versions = [
      { id: 'v1', price_amount: 7900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge' } },
    ]
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'already active' }) }))
    const showToast = vi.fn()
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={showToast} />)
    await waitFor(() => expect(screen.getByText('Buy Forge')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Buy Forge'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('already active'))
    expect(screen.getByText('Buy Forge')).not.toBeDisabled()
  })
})
