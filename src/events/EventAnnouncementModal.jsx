import { useEffect, useRef, useState } from 'react'
import { CalendarDays, MapPin, Dumbbell } from 'lucide-react'
import { COLORS } from '../theme'
import { TYPE } from '../typography'
import { RADIUS } from '../spacing'
import { Button } from '../components'
import { eventsStrings } from './eventsStrings'
import { formatEventWhen } from './eventFormat'
import { eventDivisions } from './eventModel'
import * as defaultApi from './eventsApi'

/**
 * One pending announcement at a time (the queue lives in
 * useEventAnnouncements). Focus is trapped like components.jsx's Modal; Escape
 * = MAYBE LATER (an explicit keyboard dismissal). Backdrop taps deliberately do
 * nothing - an accidental tap must never acknowledge an announcement.
 */
export function EventAnnouncementModal({ announcement: a, gymId, total, working, error, joinedAwaitingAck, onJoin, onLater, onView, lang, api = defaultApi }) {
  const s = eventsStrings(lang)
  const ref = useRef(null)
  const [details, setDetails] = useState(null)
  const [division, setDivision] = useState(null)

  // The pending row carries no divisions/capacity - read the event itself (RLS: same visibility).
  useEffect(() => {
    let cancelled = false
    api.fetchEvent(gymId, a.id)
      .then((row) => { if (!cancelled) setDetails(row) })
      .catch(() => { if (!cancelled) setDetails(null) })
    return () => { cancelled = true }
  }, [api, gymId, a.id])

  const divisions = details ? eventDivisions(details) : []
  const chosen = division && divisions.includes(division) ? division : divisions[0] || null

  const laterRef = useRef(onLater)
  useEffect(() => { laterRef.current = onLater })
  useEffect(() => {
    const previouslyFocused = document.activeElement
    ref.current?.querySelector('button:not([disabled])')?.focus()
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { laterRef.current(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const list = [...ref.current.querySelectorAll('button:not([disabled]), select, [href]')]
      if (list.length === 0) return
      const i = list.indexOf(document.activeElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus() }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [a.id, a.announcement_revision])

  const cover = api.coverUrl(a.cover_path)
  const registrationPossible = a.registration_enabled
  const primaryLabel = working ? s.announcementWorking
    : a.is_registered || joinedAwaitingAck ? s.announcementOk
    : registrationPossible ? s.announcementJoin
    : s.announcementView

  const primary = () => {
    if (a.is_registered || joinedAwaitingAck || registrationPossible) onJoin(chosen)
    else onView()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="event-announcement-title"
        style={{ background: COLORS.surface.default, borderRadius: '20px', width: '100%', maxWidth: '380px', maxHeight: 'calc(100% - 32px)', overflowY: 'auto', boxShadow: COLORS.shadow.md }}>
        {cover ? (
          <img src={cover} alt="" style={{ display: 'block', width: '100%', height: '150px', objectFit: 'cover', borderRadius: '20px 20px 0 0' }} />
        ) : (
          <div style={{ height: '8px', background: COLORS.brand.default, borderRadius: '20px 20px 0 0' }} />
        )}
        <div style={{ padding: '20px 20px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ ...TYPE.label, color: COLORS.brand.ink }}>{s.announcementLabel} · {a.event_type}</span>
            {total > 1 && <span style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>{s.announcementCounter(1, total)}</span>}
          </div>
          <h2 id="event-announcement-title" style={{ ...TYPE.pageTitle, color: COLORS.text.primary, margin: '0 0 12px' }}>{a.title}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
            <Detail icon={CalendarDays} text={formatEventWhen(a, lang)} />
            {a.location && <Detail icon={MapPin} text={a.location} />}
            {a.has_workout && a.workout_format && <Detail icon={Dumbbell} text={a.workout_format} />}
          </div>
          {a.description && (
            <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: '0 0 14px', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-line' }}>
              {a.description}
            </p>
          )}

          {(a.is_registered || joinedAwaitingAck) && (
            <div role="status" style={{ ...TYPE.metadata, color: COLORS.feedback.success, background: COLORS.feedback.successSoft, borderRadius: RADIUS.input, padding: '8px 10px', marginBottom: '12px' }}>
              {s.announcementAlreadyRegistered}
            </div>
          )}

          {!a.is_registered && !joinedAwaitingAck && registrationPossible && divisions.length > 1 && (
            <label style={{ display: 'block', marginBottom: '14px' }}>
              <span style={{ ...TYPE.label, color: COLORS.text.tertiary, display: 'block', marginBottom: '6px' }}>{s.chooseDivision}</span>
              <select value={chosen || ''} onChange={(e) => setDivision(e.target.value)} disabled={working}
                style={{ width: '100%', padding: '11px 12px', borderRadius: RADIUS.input, border: `1px solid ${COLORS.border}`, fontSize: '14px', background: COLORS.surface.subtle }}>
                {divisions.map((d) => <option key={d} value={d}>{s.divisionLabels[d] || d}</option>)}
              </select>
            </label>
          )}

          {error && (
            <div role="alert" style={{ ...TYPE.metadata, color: COLORS.feedback.danger, background: COLORS.feedback.dangerSoft, borderRadius: RADIUS.input, padding: '8px 10px', marginBottom: '12px' }}>
              {error === 'generic' || error === 'network' ? `${s.err[error]} ${s.announcementAckFailed}` : s.err[error] || s.announcementAckFailed}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button onClick={primary} disabled={working}>{primaryLabel}</Button>
            <button type="button" onClick={onLater} disabled={working}
              style={{ width: '100%', padding: '12px 16px', borderRadius: RADIUS.button, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text.secondary, ...TYPE.button, cursor: working ? 'not-allowed' : 'pointer' }}>
              {s.announcementLater}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Detail({ icon: Icon, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...TYPE.metadata, color: COLORS.text.secondary }}>
      <Icon size={15} strokeWidth={2} color={COLORS.text.tertiary} aria-hidden />
      <span>{text}</span>
    </div>
  )
}
