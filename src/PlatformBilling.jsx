import { useState, useEffect, useCallback } from 'react'
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
//
// M10.6 - Plan Upgrade/Downgrade/Cancel (M10_IMPLEMENTATION_PLAN.md
// Section 7). No new screen, exactly as that section requires - the
// plan-change selector and cancel-confirmation flow are added directly to
// this already-existing "active plan" branch. Upgrade/downgrade call the
// same RPC pair directly via supabase.rpc() (no Edge Function - Section
// 7's own "amount is always server-derived... no external call needed").
// After a successful cancel, this component's own existing fetch (which
// already filters on status='active') naturally falls through to the
// no-active-subscription branch below and shows the ordinary Buy CTA -
// exactly Section 7's own "reactivate via M10.5's purchase flow" cycle,
// with no additional code required for that specific path.
export default function PlatformBilling({ gymId, t, lang, showToast }) {
  const [loading, setLoading] = useState(true)
  const [activeSubscription, setActiveSubscription] = useState(null)
  const [activeVersion, setActiveVersion] = useState(null)
  const [otherVersions, setOtherVersions] = useState([])
  const [purchasing, setPurchasing] = useState(false)
  const [changingVersionId, setChangingVersionId] = useState(null)
  const [confirmingVersionId, setConfirmingVersionId] = useState(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    if (!gymId) return
    const { data: sub } = await supabase
      .from('platform_subscriptions')
      .select('id, platform_plan_version_id, price_amount, currency, started_at, renews_at')
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .maybeSingle()

    if (sub) {
      setActiveSubscription(sub)
      // Every OTHER currently-sellable Version, for the plan-change
      // selector - correctly empty today (M10.4 seeded exactly one tier),
      // and correct without any further code the moment a second tier
      // ever exists (docs/architecture/PLATFORM_BILLING_MODEL.md's own
      // "Later" note on multi-tier).
      const { data: versions } = await supabase
        .from('platform_plan_versions')
        .select('id, price_amount, currency, billing_cadence, trial_days, platform_plans(name)')
        .is('retired_at', null)
        .neq('id', sub.platform_plan_version_id)
      setOtherVersions(versions || [])
      setLoading(false)
      return
    }

    setActiveSubscription(null)
    setOtherVersions([])
    // No active Subscription - show the sellable catalog instead (the
    // same public read M10.4's own PricingPage already uses).
    const { data: versions } = await supabase
      .from('platform_plan_versions')
      .select('id, price_amount, currency, billing_cadence, trial_days, platform_plans(name)')
      .is('retired_at', null)
      .limit(1)
    setActiveVersion(versions?.[0] || null)
    setLoading(false)
  }, [gymId])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      await load()
      if (cancelled) return
    }
    run()
    return () => { cancelled = true }
  }, [load])

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

  const changePlan = async (version) => {
    setChangingVersionId(version.id)
    setConfirmingVersionId(null)
    const isUpgrade = version.price_amount >= activeSubscription.price_amount
    const rpcName = isUpgrade ? 'upgrade_platform_plan' : 'downgrade_platform_plan'
    const { error } = await supabase.rpc(rpcName, { p_gym_id: gymId, p_new_platform_plan_version_id: version.id })
    if (error) {
      showToast(error.message || t.toastGenericError)
      setChangingVersionId(null)
      return
    }
    showToast(isUpgrade ? t.billingUpgradeSuccess : t.billingDowngradeSuccess)
    setChangingVersionId(null)
    setLoading(true)
    await load()
  }

  const cancelSubscription = async () => {
    setCancelling(true)
    const { error } = await supabase.rpc('cancel_platform_subscription', { p_gym_id: gymId })
    if (error) {
      showToast(error.message || t.toastGenericError)
      setCancelling(false)
      setConfirmingCancel(false)
      return
    }
    showToast(t.billingCancelSuccess)
    setCancelling(false)
    setConfirmingCancel(false)
    setLoading(true)
    await load()
  }

  if (loading) {
    return <div style={{ fontSize: '13px', color: '#888', padding: '20px', textAlign: 'center' }}>{t.pricingLoading}</div>
  }

  if (activeSubscription) {
    const locale = lang === 'ro' ? 'ro-RO' : 'en-US'
    const formattedPrice = new Intl.NumberFormat(locale, { style: 'currency', currency: activeSubscription.currency, minimumFractionDigits: 0 }).format(activeSubscription.price_amount / 100)
    return (
      <div>
        <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #0E0E0E', marginBottom: '14px' }}>
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

        {otherVersions.length > 0 && (
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', marginBottom: '10px' }}>{t.billingChangePlanTitle}</div>
            {otherVersions.map((v) => {
              const isUpgrade = v.price_amount >= activeSubscription.price_amount
              const versionPrice = new Intl.NumberFormat(locale, { style: 'currency', currency: v.currency, minimumFractionDigits: 0 }).format(v.price_amount / 100)
              const isBusy = changingVersionId === v.id
              return (
                <div key={v.id} style={{ borderTop: '1px solid #f0f0f0', paddingTop: '10px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E' }}>{v.platform_plans?.name}</div>
                      <div style={{ fontSize: '12px', color: '#888' }}>{versionPrice}{t.pricingCadenceMonthly}</div>
                    </div>
                    {confirmingVersionId === v.id ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => changePlan(v)} disabled={isBusy}
                          style={{ padding: '7px 12px', background: isBusy ? '#e0e0e0' : '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: isBusy ? 'not-allowed' : 'pointer' }}>
                          {isBusy ? t.billingChangingPlan : t.billingConfirmChange}
                        </button>
                        <button onClick={() => setConfirmingVersionId(null)} disabled={isBusy}
                          style={{ padding: '7px 12px', background: 'transparent', color: '#888', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                          {t.billingCancelChangeAction}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmingVersionId(v.id)}
                        style={{ padding: '7px 12px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                        {isUpgrade ? t.billingUpgradeButton : t.billingDowngradeButton}
                      </button>
                    )}
                  </div>
                  {confirmingVersionId === v.id && (
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px' }}>{t.billingChangeEffectiveNote}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          {!confirmingCancel ? (
            <button onClick={() => setConfirmingCancel(true)}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#E24B4A', border: '1px solid #E24B4A', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              {t.billingCancelButton}
            </button>
          ) : (
            <div>
              <div style={{ fontSize: '13px', color: '#0E0E0E', marginBottom: '10px' }}>{t.billingCancelConfirmText}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={cancelSubscription} disabled={cancelling}
                  style={{ flex: 1, padding: '11px', background: cancelling ? '#e0e0e0' : '#E24B4A', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: cancelling ? 'not-allowed' : 'pointer' }}>
                  {cancelling ? t.billingCancelling : t.billingCancelConfirmButton}
                </button>
                <button onClick={() => setConfirmingCancel(false)} disabled={cancelling}
                  style={{ flex: 1, padding: '11px', background: 'transparent', color: '#888', border: '1px solid #e0e0e0', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {t.billingCancelChangeAction}
                </button>
              </div>
            </div>
          )}
        </div>
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
