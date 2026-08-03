import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import PlanCard from './PlanCard.jsx'

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// M10.5 Platform Purchase Flow - Billing settings screen
// (M10_IMPLEMENTATION_PLAN.md Section 6 Frontend impact: "Billing settings
// (current plan, purchase CTA)"). Owner-only - never rendered for a
// non-Owner Admin (App.jsx's own isOwner gate, mirroring Section 4's tier
// distinction). Self-contained (own fetch), same pattern as
// ActivationDashboard.jsx.
//
// M10.5_PRODUCT_DECISIONS.md Decision 3 - the purchase CTA is rendered at
// all only when the Gym has no active Platform Subscription; once paying,
// this screen shows a read-only "Active Plan" summary instead, mirroring
// App.jsx's own already-live "Active Plan" card for Member billing
// (no Buy/Renew action exists anywhere on that card once a Membership is
// active) - the same design, reused for the identical reason.
export default function PlatformBilling({ gymId, t, lang, showToast }) {
  const [loading, setLoading] = useState(true)
  const [activeSubscription, setActiveSubscription] = useState(null)
  const [activeVersion, setActiveVersion] = useState(null)
  const [purchasing, setPurchasing] = useState(false)

  useEffect(() => {
    if (!gymId) return
    let cancelled = false
    const load = async () => {
      const { data: sub } = await supabase
        .from('platform_subscriptions')
        .select('id, price_amount, currency, started_at, renews_at')
        .eq('gym_id', gymId)
        .eq('status', 'active')
        .maybeSingle()
      if (cancelled) return
      if (sub) {
        setActiveSubscription(sub)
        setLoading(false)
        return
      }
      // No active Subscription - show the sellable catalog instead (the
      // same public read M10.4's own PricingPage already uses).
      const { data: versions } = await supabase
        .from('platform_plan_versions')
        .select('id, price_amount, currency, billing_cadence, trial_days, platform_plans(name)')
        .is('retired_at', null)
        .limit(1)
      if (cancelled) return
      setActiveVersion(versions?.[0] || null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [gymId])

  const purchase = async () => {
    setPurchasing(true)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch(`${EDGE_BASE}/purchase-platform-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        showToast(body.error || t.toastGenericError)
        setPurchasing(false)
        return
      }
      window.location.href = body.url
    } catch (e) {
      console.error('PlatformBilling purchase:', e)
      showToast(t.toastGenericError)
      setPurchasing(false)
    }
  }

  if (loading) {
    return <div style={{ fontSize: '13px', color: '#888', padding: '20px', textAlign: 'center' }}>{t.pricingLoading}</div>
  }

  if (activeSubscription) {
    const locale = lang === 'ro' ? 'ro-RO' : 'en-US'
    const formattedPrice = new Intl.NumberFormat(locale, { style: 'currency', currency: activeSubscription.currency, minimumFractionDigits: 0 }).format(activeSubscription.price_amount / 100)
    return (
      <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #0E0E0E' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{t.billingActivePlanLabel}</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#0E0E0E' }}>Forge</div>
          </div>
          <span style={{ background: '#f0f0f0', color: '#0E0E0E', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>{t.billingActiveBadge}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>{t.billingPriceLabel}</span>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{formattedPrice}{t.pricingCadenceMonthly}</span>
        </div>
        {activeSubscription.renews_at && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>{t.billingRenewsLabel}</span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>
              {new Date(activeSubscription.renews_at).toLocaleDateString(locale)}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (!activeVersion) {
    return <div style={{ fontSize: '13px', color: '#888', padding: '20px', textAlign: 'center' }}>{t.pricingErrorText}</div>
  }

  return (
    <div>
      <PlanCard
        name={activeVersion.platform_plans?.name}
        priceAmount={activeVersion.price_amount}
        currency={activeVersion.currency}
        billingCadence={activeVersion.billing_cadence}
        trialDays={activeVersion.trial_days}
        lang={lang}
        t={t}
      />
      <button onClick={purchase} disabled={purchasing}
        style={{ width: '100%', marginTop: '14px', padding: '13px', background: purchasing ? '#e0e0e0' : '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: purchasing ? 'not-allowed' : 'pointer' }}>
        {purchasing ? t.billingPurchasing : t.billingBuyButton}
      </button>
    </div>
  )
}
