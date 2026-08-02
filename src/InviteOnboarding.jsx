import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { getT } from './translations.js'
import Shell from './InviteShell.jsx'
import { inputStyle, buttonStyle, buttonDisabledStyle } from './inviteUiKit.js'

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// M9 Invite Member & Onboarding (Product Specification Section 4.2).
// Public, unauthenticated - no Supabase session exists anywhere in this
// component before the very last step (Model D: real identity is created
// only at Final Commit, never before). Authority throughout is possession
// of {invitationId, token} from the URL, verified server-side on every
// call - nothing here is trusted client state.
//
// Steps: loading -> invalid | profile -> waiver -> submitting -> success |
// error. "Accept & Complete" (the waiver step's own submit button) is the
// single action that performs Final Commit - there is no earlier point
// where anything permanent is written.
//
// M9.1 (2026-08-01): the email-OTP step was removed - see the M9.1
// architecture report. The invitation token itself (256-bit random,
// HMAC-hashed at rest, single-use, time-limited, revocable, tenant-scoped)
// already provides everything the OTP step added on top of it; Forge is
// invite-only (no public registration), so the admin's own act of sending
// the invitation to a specific address is the trust boundary, matching
// Slack/Notion/Linear/GitHub/Figma/Atlassian's own invitation flows.
//
// i18n: `lang` is local component state, defaulting to 'en' (Forge's
// global default for brand-new invitees - App.jsx's own pre-auth default
// stays untouched, this is a separate, earlier bootstrap with no Member
// row to read a preference from yet). It becomes canonical only at Final
// Commit, written to members.language exactly like the chosen gender/unit.
// Reusing the existing getT(lang)/translations.js mechanism deliberately -
// no second i18n system.

// Backend Edge Functions return a fixed, small set of Romanian error
// strings today (Final Auth-Handoff Security Report's existing contract,
// unchanged by this feature - see COMMIT_FAILURE_MESSAGES and each
// function's own errorResponse() calls). Mapping known strings to
// translation keys client-side avoids touching those response contracts
// (§6/§22/§23 of the Preferences task: OTP/waiver semantics stay
// untouched) while still translating every error state a user can hit;
// an unmapped/unexpected string falls back to the server's raw text
// rather than breaking.
const SERVER_ERROR_KEYS = {
  'Link invalid': 'inviteErrLinkInvalid',
  'Această invitație nu mai este validă': 'inviteErrInvitationInvalid',
  'Date lipsă': 'inviteErrMissingFields',
  'Regulamentul a fost actualizat. Te rugăm să îl revizuiești din nou.': 'inviteErrStaleWaiver',
  'A apărut o eroare neașteptată. Te rugăm să încerci din nou.': 'inviteErrMembershipMissing',
  'Contul a fost deja activat.': 'inviteErrAlreadyActivated',
  'Preferințe invalide': 'inviteErrInvalidPreferences',
}
function translateServerError(t, raw) {
  const key = raw && SERVER_ERROR_KEYS[raw]
  return key ? t[key] : (raw || t.inviteGenericError)
}

async function callFn(name, body) {
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

// inputStyle/buttonStyle/buttonDisabledStyle now imported from
// inviteUiKit.js, Shell from InviteShell.jsx (both above) - moved out of
// this file, not just exported from it, to fix the react-refresh/only-
// export-components lint error that resulted from exporting them
// alongside this file's own default component export. AcceptAdminInvitation.jsx
// (M10.3) imports the same two files rather than duplicating these values.
const labelStyle = { fontSize: '12px', color: '#888', marginBottom: '4px', fontWeight: '500' }
const sectionTitleStyle = { fontSize: '12px', fontWeight: '700', color: '#888', letterSpacing: '0.5px', textTransform: 'uppercase', margin: '20px 0 12px' }
const tileRowStyle = { display: 'flex', gap: '10px', marginBottom: '14px' }
function tileStyle(active) {
  return { flex: 1, padding: '14px 10px', borderRadius: '12px', border: `2px solid ${active ? '#0E0E0E' : '#e0e0e0'}`, background: active ? '#0E0E0E' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }
}
function tileLabelStyle(active) {
  return { fontSize: '13px', fontWeight: '700', color: active ? '#ABE73C' : '#888' }
}

export default function InviteOnboarding({ invitationId }) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('t') || '')
  const [lang, setLang] = useState('en')
  const t = getT(lang)
  const [step, setStep] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [gymName, setGymName] = useState('')
  const [invitedEmail, setInvitedEmail] = useState('')
  const [waiver, setWaiver] = useState(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [gender, setGender] = useState('')
  const [weightUnit, setWeightUnit] = useState('kg')

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!invitationId || !token) { setStep('invalid'); return }
    ;(async () => {
      const { ok, json } = await callFn('invitation-status', { invitation_id: invitationId, token })
      if (!ok) { setStep('invalid'); return }
      setGymName(json.gym_name || '')
      setInvitedEmail(json.invited_email || '')
      setWaiver(json.waiver || null)
      setStep('profile')
    })()
  }, [invitationId, token])

  const profileValid = firstName.trim() && lastName.trim() && birthDate && gender

  const submitProfile = (e) => {
    e.preventDefault()
    if (!profileValid) return
    setStep('waiver')
  }

  const acceptAndComplete = async () => {
    if (!waiver) { setErrorMsg(t.inviteWaiverUnavailable); return }
    setSubmitting(true)
    setErrorMsg('')
    const { ok, json } = await callFn('invitation-final-commit', {
      invitation_id: invitationId,
      token,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      birth_date: birthDate,
      gender,
      language: lang,
      weight_unit: weightUnit,
      waiver_id: waiver.id,
    })
    setSubmitting(false)
    if (!ok) { setErrorMsg(translateServerError(t, json.error)); return }

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
    return <Shell><p style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>{t.inviteLoading}</p></Shell>
  }

  if (step === 'invalid') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '15px', color: '#0E0E0E', fontWeight: '600', marginBottom: '8px' }}>{t.inviteInvalidTitle}</p>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#888' }}>{t.inviteInvalidBody}</p>
      </Shell>
    )
  }

  const displayGymName = gymName || t.inviteDefaultGymName

  if (step === 'profile') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '14px', color: '#888', marginBottom: '20px' }}>{t.inviteProfileIntro(displayGymName)}</p>
        <form onSubmit={submitProfile}>
          <div style={sectionTitleStyle}>{t.inviteProfilePersonalDetailsTitle}</div>
          <div style={labelStyle}>{t.inviteProfileEmailLabel}</div>
          <input value={invitedEmail} readOnly disabled style={{ ...inputStyle, color: '#888', background: '#f0f0f0' }} />
          <div style={labelStyle}>{t.inviteProfileFirstNameLabel}</div>
          <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} autoFocus />
          <div style={labelStyle}>{t.inviteProfileLastNameLabel}</div>
          <input value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
          <div style={labelStyle}>{t.inviteProfilePhoneLabel}</div>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t.inviteProfilePhonePlaceholder} style={inputStyle} />
          <div style={labelStyle}>{t.inviteProfileBirthDateLabel}</div>
          <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} style={inputStyle} />

          <div style={labelStyle}>{t.inviteProfileGenderLabel}</div>
          <div style={tileRowStyle}>
            {[{ val: 'masculin', icon: '♂', label: t.inviteProfileGenderMale }, { val: 'feminin', icon: '♀', label: t.inviteProfileGenderFemale }].map(g => (
              <div key={g.val} onClick={() => setGender(g.val)} style={tileStyle(gender === g.val)}>
                <div style={{ fontSize: '20px', marginBottom: '2px', color: gender === g.val ? '#ABE73C' : '#888' }}>{g.icon}</div>
                <div style={tileLabelStyle(gender === g.val)}>{g.label}</div>
              </div>
            ))}
          </div>

          <div style={sectionTitleStyle}>{t.inviteProfilePreferencesTitle}</div>
          <div style={labelStyle}>{t.inviteProfileUnitSystemLabel}</div>
          <div style={tileRowStyle}>
            {[{ val: 'kg', label: t.inviteProfileUnitKgLabel }, { val: 'lbs', label: t.inviteProfileUnitLbsLabel }].map(u => (
              <div key={u.val} onClick={() => setWeightUnit(u.val)} style={tileStyle(weightUnit === u.val)}>
                <div style={tileLabelStyle(weightUnit === u.val)}>{u.label}</div>
              </div>
            ))}
          </div>

          <div style={labelStyle}>{t.inviteProfileLanguageLabel}</div>
          <div style={tileRowStyle}>
            {[{ val: 'en', label: 'English' }, { val: 'ro', label: 'Română' }].map(l => (
              <div key={l.val} onClick={() => setLang(l.val)} style={tileStyle(lang === l.val)}>
                <div style={tileLabelStyle(lang === l.val)}>{l.label}</div>
              </div>
            ))}
          </div>

          <button type="submit" disabled={!profileValid} style={!profileValid ? buttonDisabledStyle : buttonStyle}>{t.inviteProfileContinueButton}</button>
        </form>
      </Shell>
    )
  }

  if (step === 'waiver') {
    return (
      <Shell>
        <p style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '4px' }}>{waiver?.title || t.inviteWaiverDefaultTitle}</p>
        <div style={{ maxHeight: '240px', overflowY: 'auto', fontSize: '13px', color: '#555', lineHeight: '1.6', background: '#f8f8f8', borderRadius: '10px', padding: '14px', marginBottom: '18px', border: '1px solid #eee', whiteSpace: 'pre-wrap' }}>
          {waiver?.content_ref || t.inviteWaiverUnavailable}
        </div>
        {errorMsg && <p style={{ color: '#E24B4A', fontSize: '13px', marginBottom: '12px' }}>{errorMsg}</p>}
        <button onClick={acceptAndComplete} disabled={submitting || !waiver} style={(submitting || !waiver) ? buttonDisabledStyle : buttonStyle}>
          {submitting ? t.inviteWaiverSubmitting : t.inviteWaiverAcceptButton}
        </button>
      </Shell>
    )
  }

  if (step === 'success') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{t.inviteSuccessTitle(displayGymName)}</p>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#888', marginBottom: '20px' }}>{t.inviteSuccessBody}</p>
        <button onClick={() => { window.location.href = '/' }} style={buttonStyle}>{t.inviteSuccessButton}</button>
      </Shell>
    )
  }

  if (step === 'success_no_session') {
    return (
      <Shell>
        <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{t.inviteSuccessNoSessionTitle}</p>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#888' }}>{t.inviteSuccessNoSessionBody(invitedEmail)}</p>
      </Shell>
    )
  }

  return null
}
