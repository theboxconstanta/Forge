import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import PricingPage from './PricingPage'

// M10.4 Platform Plan Catalog & Pricing Page. Public, unauthenticated - a
// pure read of platform_plan_versions under RLS, no Edge Function. These
// tests cover the loaded happy path (one active Version, M10.4's own seed
// shape) and the query-error state; no purchase action exists anywhere on
// this page (M10.5's own job, not this milestone's).

function mockQueryResult(data, error = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(async () => ({ data, error })),
        })),
      })),
    })),
  }
}

vi.mock('./supabase.js', () => ({ supabase: {} }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PricingPage', () => {
  it('renders the active Plan Version (M10.4 seed shape)', async () => {
    const { supabase } = await import('./supabase.js')
    Object.assign(supabase, mockQueryResult([
      { id: 'v1', price_amount: 7900, currency: 'EUR', billing_cadence: 'monthly', trial_days: 14, platform_plans: { name: 'Forge' } },
    ]))
    render(<PricingPage />)
    await waitFor(() => expect(screen.getByText('Forge')).toBeInTheDocument())
    expect(screen.getByText('€79')).toBeInTheDocument()
    expect(screen.getByText('/month')).toBeInTheDocument()
    expect(screen.getByText('14-day free trial')).toBeInTheDocument()
    expect(screen.getByText('No card required to sign up')).toBeInTheDocument()
  })

  it('shows an error state when the query fails', async () => {
    const { supabase } = await import('./supabase.js')
    Object.assign(supabase, mockQueryResult(null, { message: 'network error' }))
    render(<PricingPage />)
    await waitFor(() => expect(screen.getByText("We couldn't load pricing right now. Please try again.")).toBeInTheDocument())
  })

  it('renders nothing in the plan list when no Version is active', async () => {
    const { supabase } = await import('./supabase.js')
    Object.assign(supabase, mockQueryResult([]))
    render(<PricingPage />)
    await waitFor(() => expect(screen.getByText('Pricing')).toBeInTheDocument())
    expect(screen.queryByText('Forge')).not.toBeInTheDocument()
  })
})
