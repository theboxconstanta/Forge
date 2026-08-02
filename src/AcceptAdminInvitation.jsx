import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { getT } from './translations.js'
import Shell from './InviteShell.jsx'
import { buttonStyle, buttonDisabledStyle } from './inviteUiKit.js'

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// M10.3 Admin Invitation - public, unauthenticated acceptance page,
// parallel to InviteOnboarding.jsx (OWNER_DOMAIN_IMPLEMENTATION_
// ARCHITECTURE.md Section 5.5) but structurally simpler: no Waiver, no
// personal-details/preferences step - accepting only ever grants an Admin
// role, never a Membership, so there is nothing else to collect. Model D
// discipline reused identically: no Supabase session exists before
// Accept succeeds; authority throughout is possession of
// {invitationId, token} from the URL, verified server-side on every call.
//
// Steps: loading -> invalid | confirm -> accepting -> success | success_no_session.

async function callFn(action, body) {
  const res = await fetch(`${EDGE_BASE}/accept-admin-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, json }
}

export default function AcceptAdminInvitation({ invitationId }) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('t') || '')
  const [lang] = useState('en')
  const t = getT(lang)
  // Lazy initializer, not a setState call inside the effect below - if
  // the URL is already missing invitationId/token at mount, the initial
  // render already reflects that; the effect only ever needs to setState
  // after its own await, never synchronously in its own body.
  const [step, setStep] = useState(() => (!invitationId || !token) ? 'invalid' : 'loading')
  const [gymName, setGymName] = useState('')
  const [invitedEmail, setInvitedEmail] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!invitationId || !token) return
    ;(async () => {
      const { ok, json } = await callFn('status', { invitation_id: invitationId, token })
      if (!ok) { setStep('invalid'); return }
      setGymName(json.gym_name || '')
      setInvitedEmail(json.invited_email || '')
      setStep('confirm')
    })()
  }, [invitationId, token])

  const accept = async () => {
    setStep('accepting'); setErrorMsg('')
    const { ok, json } = await callFn('accept', { invitation_id: invitationId, token })
    if (!ok) { setErrorMsg(json.error || t.adminInviteGenericError); setStep('confirm'); return }
    if (json.token_hash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: json.token_hash, type: 'magiclink' })
      if (error) {
        console.error('AcceptAdminInvitation: session handoff failed after successful accept:', error)
        setStep('success_no_session')
        return
      }
      setStep('success')
      return
    }
    setStep('success_no_session')
  }

  if (step === 'loading') return <Shell><div style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>{t.adminInviteLoading}</div></Shell>

  if (step === 'invalid') {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '17px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{t.adminInviteInvalidTitle}</div>
          <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6' }}>{t.adminInviteInvalidText}</div>
        </div>
      </Shell>
    )
  }

  if (step === 'success' || step === 'success_no_session') {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '17px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{t.adminInviteSuccessTitle}</div>
          <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6' }}>
            {step === 'success' ? t.adminInviteSuccessText : t.adminInviteSuccessNoSessionText}
          </div>
        </div>
      </Shell>
    )
  }

  // confirm | accepting
  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{ fontSize: '17px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{t.adminInviteAcceptTitle}</div>
        <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6' }}>{t.adminInviteAcceptText(gymName, invitedEmail)}</div>
      </div>
      {errorMsg && <div style={{ fontSize: '13px', color: '#E24B4A', marginBottom: '14px', textAlign: 'center' }}>{errorMsg}</div>}
      <button onClick={accept} disabled={step === 'accepting'} style={step === 'accepting' ? buttonDisabledStyle : buttonStyle}>
        {step === 'accepting' ? t.adminInviteAccepting : t.adminInviteAcceptButton}
      </button>
    </Shell>
  )
}
