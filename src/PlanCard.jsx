// M10.4 Platform Plan Catalog & Pricing Page (M10_IMPLEMENTATION_PLAN.md
// Section 5) - presentational card for one active Platform Plan Version.
// Pure display: no purchase action anywhere on this card (M10.5's job, not
// this milestone's - "Completion definition: ... no purchase action
// available yet").
const cardStyle = { border: '1.5px solid #e0e0e0', borderRadius: '16px', padding: '28px 24px', textAlign: 'center' }
const nameStyle = { fontSize: '15px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }
const priceRowStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '4px', marginBottom: '18px' }
const priceStyle = { fontSize: '40px', fontWeight: '900', color: '#0E0E0E' }
const cadenceStyle = { fontSize: '15px', fontWeight: '600', color: '#888' }
const badgeStyle = { fontSize: '13px', color: '#0E0E0E', background: '#F3FBE0', borderRadius: '8px', padding: '8px 12px', marginBottom: '8px' }
const noteStyle = { fontSize: '13px', color: '#888' }

function formatPrice(priceAmount, currency, locale) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: priceAmount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceAmount / 100)
}

export default function PlanCard({ name, priceAmount, currency, billingCadence, trialDays, lang, t }) {
  const locale = lang === 'ro' ? 'ro-RO' : 'en-US'
  const cadenceLabel = billingCadence === 'monthly' ? t.pricingCadenceMonthly : `/${billingCadence}`
  return (
    <div style={cardStyle}>
      <div style={nameStyle}>{name}</div>
      <div style={priceRowStyle}>
        <span style={priceStyle}>{formatPrice(priceAmount, currency, locale)}</span>
        <span style={cadenceStyle}>{cadenceLabel}</span>
      </div>
      <div style={badgeStyle}>{t.pricingTrialBadge(trialDays)}</div>
      <div style={noteStyle}>{t.pricingNoCardRequired}</div>
    </div>
  )
}
