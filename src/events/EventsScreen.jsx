import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, MapPin, Users, Clock, Trophy, Medal, Dumbbell } from 'lucide-react'
import { Button, Modal, AvatarCircle, EmptyState } from '../components'
import { COLORS } from '../theme'
import { TYPE } from '../typography'
import { RADIUS } from '../spacing'
import { coalescedRefresh } from '../coalescedRefresh'
import * as defaultApi from './eventsApi'
import { eventsStrings } from './eventsStrings'
import {
  categorizeEvents, eventDisplayStatus, registrationState, divisionsShownToMembers, memberDivisionChoices, scoringState, eventErrorCode,
} from './eventModel'
import { formatEventWhen, formatDateTime, eventTimeCapText, maxEffortScoreTypeText } from './eventFormat'
import { MyAttempts, EventLeaderboard } from './EventAttempts'

const page = { maxWidth: '640px', margin: '0 auto', padding: '16px 16px 32px', boxSizing: 'border-box', width: '100%' }
const card = { background: COLORS.surface.default, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: '16px' }
const sectionTitle = { ...TYPE.sectionTitle, color: COLORS.text.tertiary, margin: '0 0 10px' }

const STATUS_TONE = {
  upcoming: { bg: COLORS.feedback.infoSoft, fg: COLORS.feedback.info },
  live: { bg: COLORS.brand.soft, fg: COLORS.brand.ink },
  ended: { bg: COLORS.surface.subtle, fg: COLORS.text.secondary },
  cancelled: { bg: COLORS.feedback.dangerSoft, fg: COLORS.feedback.danger },
  archived: { bg: COLORS.surface.subtle, fg: COLORS.text.tertiary },
}

function StatusChip({ status, s }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.ended
  const label = { upcoming: s.statusUpcoming, live: s.statusLive, ended: s.statusEnded, cancelled: s.statusCancelled, archived: s.statusArchived }[status]
  return <span style={{ ...TYPE.caption, fontWeight: 700, color: tone.fg, background: tone.bg, padding: '3px 9px', borderRadius: RADIUS.full, letterSpacing: '0.02em' }}>{label}</span>
}

function Skeleton({ height = 16, width = '100%', style }) {
  return <div aria-hidden style={{ height, width, borderRadius: '8px', background: 'linear-gradient(90deg,#F2F2F2 0%,#E9E9E9 50%,#F2F2F2 100%)', ...style }} />
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="loading" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <Skeleton height={110} style={{ borderRadius: 0 }} />
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Skeleton width="40%" height={12} /><Skeleton width="75%" height={18} /><Skeleton width="55%" height={12} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorBox({ message, onRetry, s }) {
  return (
    <div role="alert" style={{ ...card, textAlign: 'center' }}>
      <p style={{ ...TYPE.body, color: COLORS.feedback.danger, margin: '0 0 12px' }}>{message}</p>
      <Button fullWidth={false} onClick={onRetry} style={{ padding: '10px 18px' }}>{s.retry}</Button>
    </div>
  )
}

function Cover({ path, height, api }) {
  const url = api.coverUrl(path)
  if (!url) return <div style={{ height: '6px', background: COLORS.brand.default }} />
  return <img src={url} alt="" loading="lazy" style={{ display: 'block', width: '100%', height, objectFit: 'cover' }} />
}

function CapacityLine({ event, count, reg, s }) {
  if (!event.registration_enabled && !reg.isRegistered) return <span>{s.registrationOff}</span>
  const parts = [s.going(count || 0)]
  // Remaining places only mean something while the event can still be joined.
  if (reg.capacity != null && event.status === 'published') parts.push(reg.full ? s.full : s.placesLeft(reg.placesLeft))
  return <span style={{ color: reg.full && !reg.isRegistered ? COLORS.feedback.danger : undefined }}>{parts.join(' · ')}</span>
}

function EventCard({ event, count, registration, onOpen, api, lang, s }) {
  const status = eventDisplayStatus(event)
  const reg = registrationState(event, registration, count)
  return (
    <li>
      <button type="button" onClick={() => onOpen(event.id)}
        style={{ ...card, padding: 0, overflow: 'hidden', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block', opacity: status === 'cancelled' || status === 'archived' ? 0.8 : 1 }}>
        <Cover path={event.cover_path} height="120px" api={api} />
        <div style={{ padding: '12px 16px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <StatusChip status={status} s={s} />
            {reg.isRegistered && <span style={{ ...TYPE.caption, fontWeight: 700, color: COLORS.brand.contrast, background: COLORS.brand.default, padding: '3px 9px', borderRadius: RADIUS.full }}>{s.registered}</span>}
            <span style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>{event.event_type}</span>
          </div>
          <div style={{ ...TYPE.cardTitle, color: COLORS.text.primary, marginBottom: '6px' }}>{event.title}</div>
          <div style={{ ...TYPE.metadata, color: COLORS.text.secondary, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <CalendarDays size={14} aria-hidden /> {formatEventWhen(event, lang)}
          </div>
          <div style={{ ...TYPE.metadata, color: COLORS.text.secondary, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Users size={14} aria-hidden /> <CapacityLine event={event} count={count} reg={reg} s={s} />
            {event.scoring_enabled && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>· <Trophy size={13} aria-hidden /> {event.workout_format}</span>}
          </div>
        </div>
      </button>
    </li>
  )
}

const TABS = ['upcoming', 'active', 'mine', 'past']

function EventsList({ data, status, onRetry, onOpen, api, lang, s }) {
  const [chosenTab, setTab] = useState(null)
  const groups = useMemo(() => (data ? categorizeEvents(data.events, data.registrations) : null), [data])
  // Until the member picks a tab: Upcoming, or the first tab with something in it.
  const tab = chosenTab
    ?? (groups && groups.upcoming.length === 0 ? TABS.find((x) => groups[x].length > 0) : null)
    ?? 'upcoming'
  const regById = useMemo(() => Object.fromEntries((data?.registrations || []).map((r) => [r.event_id, r])), [data])
  const label = { upcoming: s.tabUpcoming, active: s.tabActive, mine: s.tabMine, past: s.tabPast }
  const empty = { upcoming: s.emptyUpcoming, active: s.emptyActive, mine: s.emptyMine, past: s.emptyPast }

  return (
    <div style={page}>
      <h1 style={{ ...TYPE.pageTitle, color: COLORS.text.primary, margin: '4px 0 14px' }}>{s.title}</h1>
      <div role="tablist" aria-label={s.title} style={{ display: 'flex', gap: '6px', overflowX: 'auto', margin: '0 -16px 14px', padding: '0 16px 2px', scrollbarWidth: 'none' }}>
        {TABS.map((t) => {
          const active = tab === t
          const n = groups ? groups[t].length : null
          return (
            <button key={t} type="button" role="tab" aria-selected={active} onClick={() => setTab(t)}
              style={{ flexShrink: 0, padding: '8px 14px', minHeight: '36px', borderRadius: RADIUS.full, border: `1px solid ${active ? COLORS.text.primary : COLORS.border}`, background: active ? COLORS.text.primary : COLORS.surface.default, color: active ? COLORS.text.inverse : COLORS.text.secondary, ...TYPE.metadata, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {label[t]}{n ? ` · ${n}` : ''}
            </button>
          )
        })}
      </div>
      {status === 'loading' && <ListSkeleton />}
      {status === 'error' && <ErrorBox message={s.loadError} onRetry={onRetry} s={s} />}
      {status === 'ready' && groups && (
        groups[tab].length === 0
          ? <div style={card}><EmptyState icon={Medal} message={empty[tab]} /></div>
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {groups[tab].map((e) => (
                <EventCard key={e.id} event={e} count={data.counts[e.id] || 0} registration={regById[e.id] || null} onOpen={onOpen} api={api} lang={lang} s={s} />
              ))}
            </ul>
          )
      )}
    </div>
  )
}

function RegistrationCard({ event, reg, count, busy, error, onJoin, onLeave, lang, s }) {
  const divisions = memberDivisionChoices(event)
  const [division, setDivision] = useState(divisions[0] || null)
  const chosen = divisions.includes(division) ? division : divisions[0] || null
  return (
    <section style={card} aria-labelledby="event-registration">
      <h3 id="event-registration" style={sectionTitle}>{s.participants}</h3>
      <div style={{ ...TYPE.body, color: COLORS.text.primary, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Users size={16} aria-hidden /> <CapacityLine event={event} count={count} reg={reg} s={s} />
      </div>
      {event.registration_enabled && !reg.isRegistered && (
        <div style={{ ...TYPE.metadata, color: COLORS.text.tertiary, marginBottom: '12px' }}>
          {reg.reason === 'closed' ? s.registrationClosed : s.deadline(formatDateTime(reg.closesAt, lang))}
        </div>
      )}
      {reg.isRegistered && (
        <div role="status" style={{ ...TYPE.bodyStrong, color: COLORS.feedback.success, background: COLORS.feedback.successSoft, padding: '10px 12px', borderRadius: RADIUS.input, margin: '8px 0 12px' }}>
          {divisionsShownToMembers(event) ? s.youAreRegistered(s.divisionLabels[reg.division] || reg.division) : s.youAreRegisteredPlain}
        </div>
      )}
      {reg.canJoin && divisions.length > 1 && (
        <label style={{ display: 'block', marginBottom: '12px' }}>
          <span style={{ ...TYPE.label, color: COLORS.text.tertiary, display: 'block', marginBottom: '6px' }}>{s.chooseDivision}</span>
          <select value={chosen || ''} onChange={(e) => setDivision(e.target.value)} disabled={busy}
            style={{ width: '100%', padding: '11px 12px', borderRadius: RADIUS.input, border: `1px solid ${COLORS.border}`, fontSize: '14px', background: COLORS.surface.subtle }}>
            {divisions.map((d) => <option key={d} value={d}>{s.divisionLabels[d] || d}</option>)}
          </select>
        </label>
      )}
      {error && <div role="alert" style={{ ...TYPE.metadata, color: COLORS.feedback.danger, marginBottom: '10px' }}>{error}</div>}
      {reg.canJoin && <Button onClick={() => onJoin(chosen)} disabled={busy}>{busy ? s.joining : s.join}</Button>}
      {!reg.canJoin && !reg.isRegistered && event.registration_enabled && event.status === 'published' && (
        <Button disabled>{reg.full ? s.full : s.registrationClosed}</Button>
      )}
      {reg.isRegistered && reg.canLeave && (
        <button type="button" onClick={onLeave} disabled={busy}
          style={{ width: '100%', padding: '12px', borderRadius: RADIUS.button, border: `1px solid ${COLORS.border}`, background: 'transparent', ...TYPE.button, color: COLORS.text.secondary, cursor: busy ? 'not-allowed' : 'pointer' }}>
          {busy ? s.leaving : s.leave}
        </button>
      )}
    </section>
  )
}

function ParticipantsCard({ event, participants, membersById, memberId, count, s }) {
  const others = participants.filter((p) => p.member_id !== memberId)
  const hidden = !event.participants_visible
  return (
    <section style={card} aria-labelledby="event-participants">
      <h3 id="event-participants" style={sectionTitle}>{s.participants} · {count}</h3>
      {hidden ? (
        <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: 0 }}>{s.participantsHidden}</p>
      ) : participants.length === 0 ? (
        <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: 0 }}>{s.noParticipants}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...participants.filter((p) => p.member_id === memberId), ...others].map((p) => {
            const m = membersById[p.member_id]
            const name = m?.full_name || m?.email || '—'
            return (
              <li key={p.member_id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AvatarCircle name={name} avatarUrl={m?.avatar_url} size={30} />
                <span style={{ ...TYPE.body, color: COLORS.text.primary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}{p.member_id === memberId ? ` · ${s.you}` : ''}</span>
                {divisionsShownToMembers(event) && <span style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>{s.divisionLabels[p.division] || p.division}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function EventDetail({ eventId, gymId, memberId, version, onBack, api, showToast, memberWeightUnit, lang, t, s }) {
  const [state, setState] = useState({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [regError, setRegError] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const inFlight = useRef(false)
  // loadRef: direct, awaitable load (after the member's own action).
  // reloadRef: the coalesced trigger for live signals - bursts never overlap
  // or reorder responses.
  const loadRef = useRef(null)
  const reloadRef = useRef(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const event = await api.fetchEvent(gymId, eventId)
        if (!alive) return
        if (!event) { setState({ status: 'notFound' }); return }
        const [regs, counts, participants, attempts] = await Promise.all([
          api.fetchMyRegistrations(gymId, memberId),
          api.fetchRegistrationCounts([eventId]),
          api.fetchParticipants(gymId, eventId),
          event.has_workout && event.scoring_enabled ? api.fetchAttempts(gymId, eventId) : Promise.resolve([]),
        ])
        const membersById = await api.fetchMembersByIds([...participants.map((p) => p.member_id), ...attempts.map((a) => a.member_id)])
        if (!alive) return
        setState({
          status: 'ready', event, participants, attempts, membersById,
          registration: regs.find((r) => r.event_id === eventId) || null,
          count: counts[eventId] || 0,
        })
      } catch (err) {
        if (!alive) return
        console.error('[events] detail load failed', err)
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }))
      }
    }
    loadRef.current = load
    reloadRef.current = coalescedRefresh(load)
    return () => { alive = false }
  }, [api, gymId, eventId, memberId])
  useEffect(() => { reloadRef.current?.() }, [version, eventId, api, gymId, memberId])

  const join = async (division) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setRegError(null)
    try {
      await api.joinEvent(eventId, division)
      showToast?.(s.joined)
      await loadRef.current?.()
    } catch (err) {
      setRegError(s.err[eventErrorCode(err)] || s.err.generic)
      await loadRef.current?.()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const leave = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setRegError(null)
    try {
      await api.leaveEvent(eventId)
      setConfirmLeave(false)
      showToast?.(s.left)
      await loadRef.current?.()
    } catch (err) {
      setConfirmLeave(false)
      setRegError(s.err[eventErrorCode(err)] || s.err.generic)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const backBar = (
    <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent', padding: '8px 0', ...TYPE.bodyStrong, color: COLORS.text.secondary, cursor: 'pointer', minHeight: '40px' }}>
      <ArrowLeft size={18} aria-hidden /> {s.back}
    </button>
  )

  if (state.status === 'loading') {
    return <div style={page}>{backBar}<div role="status" aria-label="loading" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}><Skeleton height={170} /><Skeleton width="60%" height={22} /><Skeleton width="80%" /><Skeleton height={90} /></div></div>
  }
  if (state.status === 'notFound') return <div style={page}>{backBar}<div style={card}><EmptyState icon={Medal} message={s.notFound} /></div></div>
  if (state.status === 'error') return <div style={page}>{backBar}<ErrorBox message={s.loadError} onRetry={() => { setState({ status: 'loading' }); reloadRef.current?.() }} s={s} /></div>

  const { event, participants, attempts, membersById, registration, count } = state
  const status = eventDisplayStatus(event)
  const reg = registrationState(event, registration, count, undefined, attempts.filter((a) => a.member_id === memberId).length)
  const scoring = scoringState(event)
  const cap = eventTimeCapText(event)
  const scoreType = maxEffortScoreTypeText(event, s)

  return (
    <div style={page}>
      {backBar}
      <article style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <Cover path={event.cover_path} height="190px" api={api} />
          <div style={{ padding: '14px 16px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <StatusChip status={status} s={s} />
              <span style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>{event.event_type}</span>
            </div>
            <h1 style={{ ...TYPE.pageTitle, color: COLORS.text.primary, margin: '0 0 10px' }}>{event.title}</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...TYPE.metadata, color: COLORS.text.secondary }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarDays size={15} aria-hidden /> {formatEventWhen(event, lang)}</span>
              {event.location && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={15} aria-hidden /> {event.location}</span>}
            </div>
            {event.description && <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: '12px 0 0', whiteSpace: 'pre-line' }}>{event.description}</p>}
          </div>
        </div>

        {status !== 'cancelled' && status !== 'archived' && (event.registration_enabled || reg.isRegistered) && (
          <RegistrationCard event={event} reg={reg} count={count} busy={busy} error={regError}
            onJoin={join} onLeave={() => setConfirmLeave(true)} lang={lang} s={s} />
        )}

        {event.has_workout && (
          <section style={card} aria-labelledby="event-workout">
            <h3 id="event-workout" style={sectionTitle}>{s.workout}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <span style={{ ...TYPE.bodyStrong, color: COLORS.text.primary, display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Dumbbell size={15} aria-hidden /> {event.workout_format}</span>
              {cap && <span style={{ ...TYPE.metadata, color: COLORS.text.tertiary, display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={13} aria-hidden /> {s.timeCap(cap)}</span>}
              {scoreType && <span style={{ ...TYPE.metadata, color: COLORS.text.tertiary }}>{scoreType}</span>}
            </div>
            {event.workout_description && <pre style={{ ...TYPE.body, fontFamily: 'inherit', whiteSpace: 'pre-wrap', color: COLORS.text.primary, margin: 0 }}>{event.workout_description}</pre>}
            {event.workout_standards && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${COLORS.divider}` }}>
                <div style={{ ...TYPE.label, color: COLORS.text.tertiary, marginBottom: '6px' }}>{s.standards}</div>
                <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: 0, whiteSpace: 'pre-line' }}>{event.workout_standards}</p>
              </div>
            )}
            {scoring.enabled && (
              <div style={{ ...TYPE.caption, color: scoring.open ? COLORS.brand.ink : COLORS.text.tertiary, marginTop: '12px' }}>
                {scoring.phase === 'open' ? s.scoringWindow(formatDateTime(event.ends_at, lang))
                  : scoring.phase === 'before' ? s.scoringOpensAt(formatDateTime(event.starts_at, lang))
                  : s.scoringClosed}
              </div>
            )}
          </section>
        )}

        {scoring.enabled && (
          <MyAttempts event={event} attempts={attempts} memberId={memberId} scoring={scoring} registered={reg.isRegistered}
            api={api} onChanged={() => loadRef.current?.()} showToast={showToast} memberWeightUnit={memberWeightUnit} lang={lang} s={s} t={t} />
        )}
        {scoring.enabled && <EventLeaderboard event={event} attempts={attempts} membersById={membersById} memberId={memberId} defaultDivision={reg.division} s={s} />}

        <ParticipantsCard event={event} participants={participants} membersById={membersById} memberId={memberId} count={count} s={s} />
      </article>

      {confirmLeave && (
        <Modal title={s.leaveConfirmTitle} onClose={() => !busy && setConfirmLeave(false)}>
          <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: '0 0 18px' }}>{s.leaveConfirmText}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button variant="destructive" disabled={busy} onClick={leave}>{busy ? s.leaving : s.leaveConfirm}</Button>
            <button type="button" disabled={busy} onClick={() => setConfirmLeave(false)}
              style={{ padding: '12px', borderRadius: RADIUS.button, border: `1px solid ${COLORS.border}`, background: 'transparent', ...TYPE.button, color: COLORS.text.secondary }}>{s.keep}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * FORGE EVENTS - member screen. Mounted by App.jsx ONLY while the gym's
 * events_enabled flag is confirmed ON; every request below additionally goes
 * through RLS / the approved RPCs. `eventId` + `onOpenEvent` make the open
 * event part of App's persisted route (refresh / direct link).
 */
export default function EventsScreen({ gymId, memberId, version, eventId, onOpenEvent, showToast, memberWeightUnit, lang, t, api = defaultApi }) {
  const s = eventsStrings(lang)
  const [list, setList] = useState({ status: 'loading', data: null })
  const reloadRef = useRef(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const events = await api.fetchMemberEvents(gymId)
        const [registrations, counts] = await Promise.all([
          api.fetchMyRegistrations(gymId, memberId),
          api.fetchRegistrationCounts(events.map((e) => e.id)),
        ])
        if (alive) setList({ status: 'ready', data: { events, registrations, counts } })
      } catch (err) {
        console.error('[events] list load failed', err)
        if (alive) setList((prev) => (prev.status === 'ready' ? prev : { status: 'error', data: null }))
      }
    }
    reloadRef.current = coalescedRefresh(load)
    return () => { alive = false }
  }, [api, gymId, memberId])
  useEffect(() => { if (!eventId) reloadRef.current?.() }, [version, eventId, api, gymId, memberId])

  if (eventId) {
    return (
      <EventDetail key={eventId} eventId={eventId} gymId={gymId} memberId={memberId} version={version}
        onBack={() => onOpenEvent(null)} api={api} showToast={showToast} memberWeightUnit={memberWeightUnit} lang={lang} t={t} s={s} />
    )
  }
  return (
    <EventsList data={list.data} status={list.status} onRetry={() => { setList({ status: 'loading', data: null }); reloadRef.current?.() }}
      onOpen={onOpenEvent} api={api} lang={lang} s={s} />
  )
}
