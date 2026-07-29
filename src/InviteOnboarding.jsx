import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// M9 Invite Member & Onboarding (Product Specification Section 4.2).
// Public, unauthenticated - no Supabase session exists anywhere in this
// component before the very last step (Model D: real identity is created
// only at Final Commit, never before). Authority throughout is possession
// of {invitationId, token} from the URL, verified server-side on every
// call - nothing here is trusted client state.
//
// Steps: loading -> invalid | profile -> verify -> waiver -> submitting ->
// success | error. "Accept & Complete" (the waiver step's own submit
// button) is the single action that performs Final Commit - there is no
// earlier point where anything permanent is written.

async function callFn(name, body) {
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #e0e0e0', fontSize: '15px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }
const labelStyle = { fontSize: '12px', color: '#888', marginBottom: '4px', fontWeight: '500' }
const buttonStyle = { width: '100%', padding: '14px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }
const buttonDisabledStyle = { ...buttonStyle, opacity: 0.6, cursor: 'not-allowed' }

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#fff' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#0E0E0E', letterSpacing: '2px' }}>FORGE</div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function InviteOnboarding({ invitationId }) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('t') || '')
  const [step, setStep] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [gymName, setGymName] = useState('')
  const [invitedEmail, setInvitedEmail] = useState('')
  const [waiver, setWaiver] = useState(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')

  const [code, setCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [codeSentOnce, setCodeSentOnce] = useState(false)

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!invitationId || !token) { setStep('invalid'); return }
    ;(async () => {
      const { ok, json } = await callFn('invitation-status', { invitation_id: invitationId, token })
      if (!ok) { setStep('invalid'); return }
      setGymName(json.gym_name || 'sala ta')
      setInvitedEmail(json.invited_email || '')
      setWaiver(json.waiver || null)
      setStep('profile')
    })()
  }, [invitationId, token])

  const submitProfile = (e) => {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    setStep('verify')
  }

  const sendCode = async () => {
    setSendingCode(true)
    setErrorMsg('')
    const { ok, json } = await callFn('invitation-challenge', { invitation_id: invitationId, token })
    setSendingCode(false)
    if (!ok) { setErrorMsg(json.error || 'A apărut o eroare'); return }
    setCodeSentOnce(true)
  }

  const verifyCode = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setVerifying(true)
    setErrorMsg('')
    const { ok, json } = await callFn('invitation-verify', { invitation_id: invitationId, token, code: code.trim() })
    setVerifying(false)
    if (!ok) { setErrorMsg(json.error || 'Cod incorect'); return }
    setStep('waiver')
  }

  const acceptAndComplete = async () => {
    if (!waiver) { setErrorMsg('Regulamentul sălii nu este disponibil momentan.'); return }
    setSubmitting(true)
    setErrorMsg('')
    const { ok, json } = await callFn('invitation-final-commit', {
      invitation_id: invitationId,
      token,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      birth_date: birthDate || null,
      waiver_id: waiver.id,
    })
    setSubmitting(false)
    if (!ok) { setErrorMsg(json.error || 'A apărut o eroare'); return }

    if (json.token_hash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: json.token_hash, type: 'magiclink' })
      if (error) {
        console.error('InviteOnboarding: session handoff failed after successful commit:', error)
        setStep('success_no_session')
        return
      }
      setStep('success')
      return
    }
    setStep('success_no_session')
  }

  if (step === 'loading') {
    return <Shell><p style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>Se încarcă...</p></Shell>
  }

  if (step === 'invalid') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '15px', color: '#0E0E0E', fontWeight: '600', marginBottom: '8px' }}>Această invitație nu mai este validă</p>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#888' }}>Link-ul a expirat, a fost deja folosit sau a fost revocat. Contactează sala pentru o invitație nouă.</p>
      </Shell>
    )
  }

  if (step === 'profile') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '14px', color: '#888', marginBottom: '20px' }}>Ai fost invitat(ă) să te alături <strong style={{ color: '#0E0E0E' }}>{gymName}</strong> pe Forge.</p>
        <form onSubmit={submitProfile}>
          <div style={labelStyle}>Email</div>
          <input value={invitedEmail} readOnly disabled style={{ ...inputStyle, color: '#888', background: '#f0f0f0' }} />
          <div style={labelStyle}>Prenume *</div>
          <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} autoFocus />
          <div style={labelStyle}>Nume *</div>
          <input value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
          <div style={labelStyle}>Telefon</div>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+40 7xx xxx xxx" style={inputStyle} />
          <div style={labelStyle}>Data nașterii</div>
          <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} style={inputStyle} />
          <button type="submit" disabled={!firstName.trim() || !lastName.trim()} style={(!firstName.trim() || !lastName.trim()) ? buttonDisabledStyle : buttonStyle}>Continuă</button>
        </form>
      </Shell>
    )
  }

  if (step === 'verify') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '14px', color: '#888', marginBottom: '20px' }}>Confirmă adresa <strong style={{ color: '#0E0E0E' }}>{invitedEmail}</strong> pentru a continua.</p>
        {!codeSentOnce ? (
          <button onClick={sendCode} disabled={sendingCode} style={sendingCode ? buttonDisabledStyle : buttonStyle}>
            {sendingCode ? 'Se trimite...' : 'Trimite cod de verificare'}
          </button>
        ) : (
          <form onSubmit={verifyCode}>
            <div style={labelStyle}>Cod de verificare (6 cifre)</div>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ ...inputStyle, textAlign: 'center', fontSize: '22px', letterSpacing: '6px' }} autoFocus />
            {errorMsg && <p style={{ color: '#E24B4A', fontSize: '13px', marginBottom: '12px' }}>{errorMsg}</p>}
            <button type="submit" disabled={verifying || code.length !== 6} style={(verifying || code.length !== 6) ? buttonDisabledStyle : buttonStyle}>
              {verifying ? 'Se verifică...' : 'Confirmă codul'}
            </button>
            <button type="button" onClick={sendCode} disabled={sendingCode} style={{ width: '100%', padding: '10px', background: 'transparent', border: 'none', color: '#888', fontSize: '13px', marginTop: '10px', cursor: 'pointer' }}>
              Retrimite codul
            </button>
          </form>
        )}
      </Shell>
    )
  }

  if (step === 'waiver') {
    return (
      <Shell>
        <p style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '4px' }}>{waiver?.title || 'Regulament'}</p>
        <div style={{ maxHeight: '240px', overflowY: 'auto', fontSize: '13px', color: '#555', lineHeight: '1.6', background: '#f8f8f8', borderRadius: '10px', padding: '14px', marginBottom: '18px', border: '1px solid #eee', whiteSpace: 'pre-wrap' }}>
          {waiver?.content_ref || 'Regulamentul sălii nu este disponibil momentan.'}
        </div>
        {errorMsg && <p style={{ color: '#E24B4A', fontSize: '13px', marginBottom: '12px' }}>{errorMsg}</p>}
        <button onClick={acceptAndComplete} disabled={submitting || !waiver} style={(submitting || !waiver) ? buttonDisabledStyle : buttonStyle}>
          {submitting ? 'Se finalizează...' : 'Accept și finalizează'}
        </button>
      </Shell>
    )
  }

  if (step === 'success') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>Bine ai venit la {gymName}!</p>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#888', marginBottom: '20px' }}>Contul tău este activ.</p>
        <button onClick={() => { window.location.href = '/' }} style={buttonStyle}>Continuă în Forge</button>
      </Shell>
    )
  }

  if (step === 'success_no_session') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>Contul tău a fost creat</p>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#888' }}>Activarea sesiunii nu s-a putut finaliza automat. Deschide aplicația și autentifică-te cu adresa {invitedEmail}, sau contactează sala pentru ajutor.</p>
      </Shell>
    )
  }

  return null
}
