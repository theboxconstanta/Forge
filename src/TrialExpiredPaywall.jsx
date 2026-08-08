import PlatformBilling from './PlatformBilling.jsx'

// M10.8 Trial Expiry Enforcement (M10_IMPLEMENTATION_PLAN.md Section 9,
// OWNER_LIFECYCLE_STATE_MACHINE.md B4). The hard-paywall screen - "clearly
// explain why access is blocked, clearly identify the expired trial,
// provide exactly one obvious recovery path."
//
// No new payment experience anywhere in this file - the Owner's own
// recovery path is the literal, already-proven PlatformBilling component
// from M10.5/M10.6, embedded directly, not re-implemented. A non-Owner
// (Admin or Member) has no way to act on Forge's own billing (M10.5's own
// Owner-only authorization, unchanged here) - showing them a Buy button
// that would only ever fail is worse than showing them the one path that
// is actually theirs: ask the Owner.
//
// This component owns no business logic of its own - whether to render
// it at all is decided entirely by is_gym_access_blocked() (server-side,
// the actual access-blocking predicate, exhaustively verified against
// every OWNER_LIFECYCLE_STATE_MACHINE.md Section 6 combination cell). No
// client-side re-derivation of that decision exists anywhere in this
// codebase - reusing the one already-tested source of truth, not
// duplicating it, per Principle 3.6 ("no client owns business logic").
export default function TrialExpiredPaywall({ isOwner, gymId, t, lang, showToast }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: '20px', padding: '32px 24px', textAlign: 'center', maxWidth: '360px', width: '100%' }}>
        <div style={{ fontSize: '18px', fontWeight: '600', color: '#0E0E0E', marginBottom: '8px' }}>{t.trialExpiredTitle}</div>
        <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6', marginBottom: '20px' }}>
          {isOwner ? t.trialExpiredOwnerText : t.trialExpiredNonOwnerText}
        </div>
        {isOwner ? (
          <div style={{ textAlign: 'left' }}>
            <PlatformBilling gymId={gymId} t={t} lang={lang} showToast={showToast} />
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: '#0E0E0E', background: '#f0f0f0', borderRadius: '10px', padding: '12px' }}>
            {t.trialExpiredContactOwner}
          </div>
        )}
      </div>
    </div>
  )
}
