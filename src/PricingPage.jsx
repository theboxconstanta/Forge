import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { getT } from './translations.js'
import Shell from './InviteShell.jsx'
import PlanCard from './PlanCard.jsx'

// M10.4 Platform Plan Catalog & Pricing Page (M10_IMPLEMENTATION_PLAN.md
// Section 5). Public, unauthenticated - reachable at /pricing without any
// session, per OWNER_ACTIVATION_ARCHITECTURE.md Section 6 ("visible
// without requiring an email first"). A pure read under RLS
// (platform_plan_versions_select_public) - no Edge Function, no RPC, per
// this milestone's own frozen Edge Function impact ("None").
//
// i18n: defaults to 'en', same convention and same reasoning as
// AcceptAdminInvitation.jsx - a brand-new, unauthenticated visitor with no
// stored language preference to read yet.
export default function PricingPage() {
  const [lang] = useState('en')
  const t = getT(lang)
  const [step, setStep] = useState('loading')
  const [versions, setVersions] = useState([])

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('platform_plan_versions')
        .select('id, price_amount, currency, billing_cadence, trial_days, platform_plans(name)')
        .is('retired_at', null)
        .order('created_at', { ascending: true })
      if (error || !data) { setStep('error'); return }
      setVersions(data)
      setStep('loaded')
    })()
  }, [])

  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ fontSize: '17px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{t.pricingPageTitle}</div>
        <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6' }}>{t.pricingPageSubtitle}</div>
      </div>

      {step === 'loading' && <div style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>{t.pricingLoading}</div>}

      {step === 'error' && <div style={{ textAlign: 'center', color: '#E24B4A', fontSize: '13px' }}>{t.pricingErrorText}</div>}

      {step === 'loaded' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {versions.map((v) => (
            <PlanCard
              key={v.id}
              name={v.platform_plans?.name}
              priceAmount={v.price_amount}
              currency={v.currency}
              billingCadence={v.billing_cadence}
              trialDays={v.trial_days}
              lang={lang}
              t={t}
            />
          ))}
        </div>
      )}
    </Shell>
  )
}
