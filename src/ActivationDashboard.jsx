import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { daysUntil } from './utils'

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// M10.2 - Activation Dashboard. Self-contained (own fetch, own realtime
// subscription, own mutations) per M10.2_FINAL_PRODUCT_REVISION.md - zero
// new tables/RPCs/events. Reads gym_activation_state/gym_commercial_state/
// gym_waivers (all pre-existing, already backfilled for every Gym by
// M10.1b); writes only via admin-manage-waiver and admin-invite-member
// (both pre-existing Edge Functions, unmodified).
//
// Dashboard Evolution decision (frozen): this component IS the evolving
// content, not a separate screen. It renders null the instant
// activation_state = 'activated' - App.jsx's own home screen, already
// built, is what an Owner then sees, unchanged.

const DEFAULT_WAIVER = {
  ro: {
    title: 'Regulament și Declarație de Asumare a Riscului',
    content: `1. Asumarea riscului
Particip la antrenamentele desfășurate în această sală din proprie inițiativă, fiind conștient(ă) că activitatea fizică de intensitate ridicată presupune riscuri reale de accidentare. Declar că starea mea de sănătate îmi permite acest tip de efort și că voi anunța antrenorii orice problemă medicală relevantă.

2. Respectarea regulilor sălii
Mă angajez să respect indicațiile antrenorilor, echipamentul și programul orar al clasei, precum și celelalte persoane prezente în sală.

3. Degrevare de răspundere
Înțeleg că sala și antrenorii nu pot fi făcuți răspunzători pentru accidentările survenite din nerespectarea instrucțiunilor primite sau din afecțiuni medicale nedeclarate.

4. Fotografii și materiale video
Sunt de acord ca imagini realizate în timpul antrenamentelor să poată fi folosite în scop promoțional de către sală, cu excepția cazului în care solicit explicit contrariul.

Acest regulament este un punct de plecare - îl poți edita liber înainte de publicare, pentru a se potrivi exact sălii tale.`,
  },
  en: {
    title: 'Waiver & Release of Liability',
    content: `1. Assumption of risk
I am participating in this gym's training sessions voluntarily, understanding that high-intensity physical activity carries real risk of injury. I confirm my health allows this level of effort and will inform coaches of any relevant medical condition.

2. Gym rules
I agree to follow coaches' instructions, equipment guidelines, and class schedules, and to be considerate of other members.

3. Release of liability
I understand the gym and its coaches are not liable for injuries resulting from failure to follow instructions or from undisclosed medical conditions.

4. Photo & video
I agree that photos/videos taken during sessions may be used for the gym's own promotion, unless I explicitly opt out.

This is a starting point - edit it freely before publishing so it fits your gym exactly.`,
  },
}

function ChevronToggle({ open }) {
  return <span style={{ fontSize: '12px', color: '#888', transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▾</span>
}

export default function ActivationDashboard({ gymId, gymName, t, lang, showToast }) {
  const [loading, setLoading] = useState(true)
  const [activationState, setActivationState] = useState(null)
  const [trialEndsAt, setTrialEndsAt] = useState(null)
  const [hasCurrentWaiver, setHasCurrentWaiver] = useState(false)

  const [waiverOpen, setWaiverOpen] = useState(false)
  // Lazy initializers, not a setState call inside the fetch effect below -
  // the template only ever needs to be computed once, from `lang` at mount.
  const [waiverTitle, setWaiverTitle] = useState(() => (DEFAULT_WAIVER[lang] || DEFAULT_WAIVER.en).title)
  const [waiverContent, setWaiverContent] = useState(() => (DEFAULT_WAIVER[lang] || DEFAULT_WAIVER.en).content)
  const [savingWaiver, setSavingWaiver] = useState(false)
  const [waiverError, setWaiverError] = useState('')

  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSentTo, setInviteSentTo] = useState('')

  const [optionalOpen, setOptionalOpen] = useState(false)

  // M10.3 - the co-admin/coach invite row, the one M10.2 optional item
  // this milestone turns from a static label into a real action
  // (M10_IMPLEMENTATION_PLAN.md's own explicit sequencing note: "add one
  // row to an already-live optional list, not build a new list from
  // scratch"). Same shape as the Member-invite state above, distinct
  // fields since the two are genuinely separate actions against separate
  // Edge Functions/tables.
  const [coachInviteEmail, setCoachInviteEmail] = useState('')
  const [sendingCoachInvite, setSendingCoachInvite] = useState(false)
  const [coachInviteError, setCoachInviteError] = useState('')
  const [coachInviteSentTo, setCoachInviteSentTo] = useState('')

  const activationStateRef = useRef(null)
  // Always-current t/showToast for the realtime callback below, without
  // making the subscription effect depend on them directly - t and
  // showToast are new references on every App render, and re-subscribing
  // the channel that often would be worse than the staleness this ref
  // exists to prevent (e.g. a toast firing in the language active at mount
  // rather than whatever language the Owner is on when the event arrives).
  const latestRef = useRef({ t, showToast })
  useEffect(() => { latestRef.current = { t, showToast } })

  useEffect(() => {
    if (!gymId) return
    let cancelled = false
    const todayStr = new Date().toISOString().slice(0, 10)

    const load = async () => {
      const [{ data: activation }, { data: commercial }, { data: waiver }] = await Promise.all([
        supabase.from('gym_activation_state').select('activation_state').eq('gym_id', gymId).maybeSingle(),
        supabase.from('gym_commercial_state').select('trial_ends_at').eq('gym_id', gymId).maybeSingle(),
        supabase.from('gym_waivers').select('id').eq('gym_id', gymId).lte('effective_date', todayStr).order('effective_date', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (cancelled) return
      activationStateRef.current = activation?.activation_state || null
      setActivationState(activation?.activation_state || null)
      setTrialEndsAt(commercial?.trial_ends_at || null)
      setHasCurrentWaiver(!!waiver)
      setLoading(false)
    }
    load()

    // Realtime, following the app's existing postgres_changes pattern
    // (App.jsx's own 'realtime-app' channel) - a dedicated, per-gym channel
    // here so this component's teardown is fully self-contained and never
    // interferes with App.jsx's own subscriptions.
    const channel = supabase.channel('activation-dashboard-' + gymId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gym_activation_state', filter: `gym_id=eq.${gymId}` }, (payload) => {
        const next = payload.new?.activation_state
        const prev = activationStateRef.current
        if (!next || next === prev) return
        activationStateRef.current = next
        setActivationState(next)
        // First Value celebration (OWNER_ACTIVATION_ARCHITECTURE.md Section 7's
        // mandatory notification) - fires exactly once, live, the instant the
        // transition happens, reusing the app's existing toast mechanism.
        if (next === 'first_value_reached' && prev !== 'first_value_reached') {
          latestRef.current.showToast(latestRef.current.t.activationFirstValueToast)
        }
      })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [gymId])

  const publishWaiver = async () => {
    if (!waiverTitle.trim() || !waiverContent.trim()) { setWaiverError(t.toastGenericError); return }
    setSavingWaiver(true); setWaiverError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_BASE}/admin-manage-waiver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'publish', title: waiverTitle.trim(), content: waiverContent }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) { setWaiverError(json.error || t.toastGenericError); setSavingWaiver(false); return }
    setHasCurrentWaiver(true)
    setWaiverOpen(false)
    setSavingWaiver(false)
  }

  const sendInvite = async () => {
    const email = inviteEmail.trim()
    if (!email) { setInviteError(t.toastFillEmail); return }
    setSendingInvite(true); setInviteError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_BASE}/admin-invite-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'create', email }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) { setInviteError(json.error || t.toastGenericError); setSendingInvite(false); return }
    setInviteSentTo(email)
    setInviteEmail('')
    setSendingInvite(false)
  }

  const sendCoachInvite = async () => {
    const email = coachInviteEmail.trim()
    if (!email) { setCoachInviteError(t.toastFillEmail); return }
    setSendingCoachInvite(true); setCoachInviteError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_BASE}/accept-admin-invitation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'send', email }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) { setCoachInviteError(json.error || t.toastGenericError); setSendingCoachInvite(false); return }
    setCoachInviteSentTo(email)
    setCoachInviteEmail('')
    setSendingCoachInvite(false)
  }

  if (loading || !activationState || activationState === 'activated') return null

  const trialDaysLeft = trialEndsAt ? daysUntil(trialEndsAt.slice(0, 10)) : null

  const card = { background: '#fff', borderRadius: '16px', padding: '18px', margin: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
  const requiredCard = { background: '#fafafa', borderRadius: '12px', padding: '14px', marginTop: '10px', border: '1px solid #eee' }

  // ── Post-First-Value, pre-Activation: lighter "Getting Started" panel ──
  if (activationState === 'first_value_reached') {
    return (
      <div style={card} role="region" aria-label={t.activationGettingStartedTitle}>
        <div style={{ fontSize: '16px', fontWeight: '700', color: '#0E0E0E', marginBottom: '4px' }}>{t.activationGettingStartedTitle}</div>
        <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.5' }}>{t.activationGettingStartedText}</div>
      </div>
    )
  }

  // ── Pre-First-Value: full checklist ──
  return (
    <div style={card} role="region" aria-label={t.activationHeaderTitle}>
      <div style={{ fontSize: '17px', fontWeight: '800', color: '#0E0E0E', marginBottom: '2px' }}>
        🎉 {gymName}
      </div>
      <div style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
        {trialDaysLeft != null ? t.activationTrialActive.replace('{days}', trialDaysLeft) : t.activationTrialActiveGeneric}
      </div>

      {/* Required 1 - Waiver */}
      <div style={requiredCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>{hasCurrentWaiver ? '✅' : '1️⃣'}</span>
          <span style={{ fontSize: '14px', fontWeight: '700', color: '#0E0E0E' }}>{t.activationWaiverTitle}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', marginLeft: '22px' }}>{t.activationWaiverDesc}</div>
        {!hasCurrentWaiver && (
          <div style={{ marginLeft: '22px', marginTop: '8px' }}>
            {!waiverOpen ? (
              <button onClick={() => setWaiverOpen(true)}
                style={{ padding: '9px 16px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                {t.activationWaiverReviewButton}
              </button>
            ) : (
              <div>
                <label htmlFor="activation-waiver-title" style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>{t.activationWaiverTitleFieldLabel}</label>
                <input id="activation-waiver-title" value={waiverTitle} onChange={e => setWaiverTitle(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px', fontFamily: 'system-ui' }} />
                <label htmlFor="activation-waiver-content" style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>{t.activationWaiverContentFieldLabel}</label>
                <textarea id="activation-waiver-content" value={waiverContent} onChange={e => setWaiverContent(e.target.value)} rows={8}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '12px', boxSizing: 'border-box', fontFamily: 'system-ui', resize: 'vertical', marginBottom: '8px' }} />
                {waiverError && <div style={{ fontSize: '12px', color: '#E24B4A', marginBottom: '8px' }}>{waiverError}</div>}
                <button onClick={publishWaiver} disabled={savingWaiver}
                  style={{ padding: '9px 16px', background: savingWaiver ? '#e0e0e0' : '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: savingWaiver ? 'not-allowed' : 'pointer', marginRight: '8px' }}>
                  {savingWaiver ? t.activationWaiverPublishing : t.activationWaiverPublishButton}
                </button>
                <button onClick={() => setWaiverOpen(false)}
                  style={{ padding: '9px 16px', background: 'transparent', color: '#888', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {t.activationCancel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Required 2 - Invite first Member */}
      <div style={requiredCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>2️⃣</span>
          <span style={{ fontSize: '14px', fontWeight: '700', color: hasCurrentWaiver ? '#0E0E0E' : '#bbb' }}>{t.activationInviteTitle}</span>
        </div>
        {!hasCurrentWaiver ? (
          <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px', marginLeft: '22px' }}>{t.activationInviteBlockedReason}</div>
        ) : (
          <>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', marginLeft: '22px' }}>{t.activationInviteDesc}</div>
            <div style={{ marginLeft: '22px', marginTop: '8px' }}>
              {inviteSentTo ? (
                <div style={{ fontSize: '13px', color: '#4A9E2F', fontWeight: '600' }}>{t.activationInviteSentConfirm.replace('{email}', inviteSentTo)}</div>
              ) : (
                <>
                  <label htmlFor="activation-invite-email" style={{ fontSize: '11px', color: '#aaa', display: 'block', marginBottom: '4px' }}>{t.activationInviteEmailLabel}</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input id="activation-invite-email" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder={t.activationInviteEmailPlaceholder}
                      style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'system-ui' }} />
                    <button onClick={sendInvite} disabled={sendingInvite}
                      style={{ padding: '9px 16px', background: sendingInvite ? '#e0e0e0' : '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: sendingInvite ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                      {sendingInvite ? t.activationInviteSending : t.activationInviteButton}
                    </button>
                  </div>
                  {inviteError && <div style={{ fontSize: '12px', color: '#E24B4A', marginTop: '6px' }}>{inviteError}</div>}
                  <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px' }}>{t.activationSelfPreviewHint}</div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Optional setup - fully collapsed behind one disclosure */}
      <div style={{ marginTop: '12px' }}>
        <button onClick={() => setOptionalOpen(o => !o)} aria-expanded={optionalOpen}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', padding: '6px 0', fontSize: '12px', color: '#888', cursor: 'pointer' }}>
          <ChevronToggle open={optionalOpen} />
          {t.activationOptionalToggle}
        </button>
        {optionalOpen && (
          <ul style={{ margin: '4px 0 0', paddingLeft: '20px', fontSize: '12px', color: '#aaa', lineHeight: '1.9' }}>
            <li>{t.activationOptionalPlanItem}</li>
            <li>{t.activationOptionalLogoItem}</li>
            <li style={{ marginBottom: '6px' }}>
              {t.activationOptionalCoachItem}
              {coachInviteSentTo ? (
                <div style={{ color: '#4A9E2F', fontWeight: '600', marginTop: '2px' }}>{t.activationCoachInviteSentConfirm(coachInviteSentTo)}</div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <input type="email" aria-label={t.activationOptionalCoachItem} value={coachInviteEmail} onChange={e => setCoachInviteEmail(e.target.value)} placeholder={t.activationCoachInviteEmailPlaceholder}
                    style={{ flex: 1, padding: '7px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px', boxSizing: 'border-box', fontFamily: 'system-ui' }} />
                  <button onClick={sendCoachInvite} disabled={sendingCoachInvite}
                    style={{ padding: '7px 10px', background: sendingCoachInvite ? '#e0e0e0' : '#0E0E0E', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: sendingCoachInvite ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                    {sendingCoachInvite ? t.activationCoachInviteSending : t.activationCoachInviteButton}
                  </button>
                </div>
              )}
              {coachInviteError && <div style={{ color: '#E24B4A', marginTop: '4px' }}>{coachInviteError}</div>}
            </li>
            <li>{t.activationOptionalPaymentsItem}</li>
            <li>{t.activationOptionalScheduleItem}</li>
          </ul>
        )}
      </div>
    </div>
  )
}
