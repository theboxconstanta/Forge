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

let queryData = {}

vi.mock('./supabase.js', () => {
  const chain = (table) => {
    const c = {
      select: () => c,
      eq: () => c,
      is: () => c,
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
    },
  }
})

const originalFetch = globalThis.fetch
const originalLocation = window.location

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryData = {}
  globalThis.fetch = originalFetch
})

describe('PlatformBilling - active subscription', () => {
  it('shows a read-only Active Plan summary, never a Buy button', async () => {
    queryData.platform_subscriptions = {
      id: 'sub1', price_amount: 7900, currency: 'EUR', started_at: '2026-08-01T00:00:00Z', renews_at: '2026-09-01T00:00:00Z',
    }
    render(<PlatformBilling gymId="gym1" t={T_EN} lang="en" showToast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Active plan')).toBeInTheDocument())
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Buy Forge')).not.toBeInTheDocument()
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
