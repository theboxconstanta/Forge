import { useMemo, useState } from 'react'
import { Trophy, Pencil, Trash2, RotateCw } from 'lucide-react'
import UniversalScoreInput from '../UniversalScoreInput'
import { Button, Modal, AvatarCircle } from '../components'
import { COLORS } from '../theme'
import { TYPE } from '../typography'
import { RADIUS } from '../spacing'
import {
  eventScoreDefinition, composeEventScoreFields, eventScoreReady, attemptToEditorValue,
  eventInputMovements, eventScoringFormat,
} from './eventScoring'
import { rankEventLeaderboard, bestAttemptId, leaderboardDivisions } from './eventLeaderboard'
import { attemptScoreText, formatDateTime } from './eventFormat'
import { ATTEMPT_LIMIT, eventErrorCode } from './eventModel'
import {
  newClientAttemptId, readPendingAttempt, clearPendingAttempt, sendAttemptIdempotently,
} from './attemptIdempotency'

const sectionTitle = { ...TYPE.sectionTitle, color: COLORS.text.tertiary, margin: '0 0 10px' }
const card = { background: COLORS.surface.default, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: '16px' }
const ghostBtn = (danger) => ({ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: '8px', color: danger ? COLORS.feedback.danger : COLORS.text.secondary, ...TYPE.metadata, cursor: 'pointer' })
const chip = (active) => ({
  flexShrink: 0, padding: '7px 12px', borderRadius: RADIUS.full, border: `1px solid ${active ? COLORS.text.primary : COLORS.border}`,
  background: active ? COLORS.text.primary : COLORS.surface.default, color: active ? COLORS.text.inverse : COLORS.text.secondary,
  ...TYPE.metadata, fontWeight: 600, cursor: 'pointer', minHeight: '34px',
})

/**
 * Score entry for one event attempt - FORGE's existing <UniversalScoreInput>,
 * driven by eventScoreDefinition (scoreDefinitionFor), composed by
 * composeEventScoreFields (the existing workoutFormats.js helpers).
 */
export function AttemptEditor({ event, initialValue, submitLabel, busy, error, onSubmit, onCancel, memberWeightUnit, s, t }) {
  const [value, setValue] = useState(initialValue || {})
  const def = eventScoreDefinition(event, memberWeightUnit)
  const { formatId, config } = eventScoringFormat(event)
  const ready = eventScoreReady(event, value, memberWeightUnit)
  if (def.kind === 'UNSUPPORTED') return <p style={{ ...TYPE.body, color: COLORS.text.secondary }}>{s.unsupportedFormat}</p>
  if (def.kind === 'MISCONFIGURED') return <p role="alert" style={{ ...TYPE.body, color: COLORS.feedback.warning }}>{s.scoreTypeMissing}</p>
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onSubmit(composeEventScoreFields(event, value, memberWeightUnit)) }}>
      <UniversalScoreInput
        def={def}
        formatId={formatId}
        config={config}
        movements={eventInputMovements(event, s)}
        value={value}
        onChange={setValue}
        weightUnit={memberWeightUnit}
        t={t}
      />
      <label style={{ display: 'block', marginTop: '12px' }}>
        <span style={{ ...TYPE.label, color: COLORS.text.tertiary, display: 'block', marginBottom: '6px' }}>{s.notes}</span>
        <textarea value={value.notes || ''} maxLength={1000} rows={2} onChange={(e) => setValue((v) => ({ ...v, notes: e.target.value }))}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: RADIUS.input, border: `1px solid ${COLORS.border}`, fontSize: '14px', fontFamily: 'inherit', background: COLORS.surface.subtle, resize: 'vertical' }} />
      </label>
      {error && <div role="alert" style={{ ...TYPE.metadata, color: COLORS.feedback.danger, marginTop: '10px' }}>{error}</div>}
      {!ready && !error && <div style={{ ...TYPE.caption, color: COLORS.text.tertiary, marginTop: '10px' }}>{s.scoreRequired}</div>}
      <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}
            style={{ flex: 1, padding: '13px', borderRadius: RADIUS.button, border: `1px solid ${COLORS.border}`, background: 'transparent', ...TYPE.button, color: COLORS.text.secondary, cursor: 'pointer' }}>
            {s.cancel}
          </button>
        )}
        <Button type="submit" disabled={!ready || busy} style={{ flex: 2 }}>{busy ? s.submitting : submitLabel}</Button>
      </div>
    </form>
  )
}

/**
 * The member's own attempts: history (deleted ones greyed, never hidden),
 * best-attempt marker, add / edit / soft-delete within the scoring window, the
 * 20-attempt counter (soft-deleted included, like the server), and recovery of
 * an unconfirmed submission with its ORIGINAL client_attempt_id.
 */
export function MyAttempts({ event, attempts, memberId, scoring, registered, api, onChanged, showToast, memberWeightUnit, lang, s, t }) {
  const mine = useMemo(() => attempts.filter((a) => a.member_id === memberId), [attempts, memberId])
  const bestId = useMemo(() => bestAttemptId(event, mine), [event, mine])
  const used = mine.length
  const [mode, setMode] = useState(null) // null | { kind: 'new', clientAttemptId } | { kind: 'edit', attempt }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(() => readPendingAttempt(memberId, event.id))
  const [confirmDelete, setConfirmDelete] = useState(null)

  const fail = (err) => setError(s.err[eventErrorCode(err)] || s.err.generic)

  const submitNew = async (clientAttemptId, fields) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const out = await sendAttemptIdempotently({
        memberId, eventId: event.id, clientAttemptId, fields,
        submit: api.submitAttempt, classify: eventErrorCode,
      })
      if (out.status === 'unknown') {
        setPending(readPendingAttempt(memberId, event.id))
        setError(s.err.network)
        return
      }
      setPending(null)
      setMode(null)
      showToast?.(s.attemptSaved)
      await onChanged()
    } catch (err) {
      setPending(readPendingAttempt(memberId, event.id))
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const submitEdit = async (attempt, fields) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.updateAttempt(attempt.id, fields)
      setMode(null)
      showToast?.(s.attemptUpdated)
      await onChanged()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }

  const doDelete = async (attempt) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAttempt(attempt.id)
      setConfirmDelete(null)
      showToast?.(s.attemptDeleted)
      await onChanged()
    } catch (err) { setConfirmDelete(null); fail(err) } finally { setBusy(false) }
  }

  // Fail safe: a Max Effort event without a valid score type takes no scores.
  const misconfigured = eventScoreDefinition(event, memberWeightUnit).kind === 'MISCONFIGURED'
  const canAdd = scoring.open && registered && used < ATTEMPT_LIMIT && !pending && !misconfigured

  return (
    <section style={card} aria-labelledby="event-my-attempts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <h3 id="event-my-attempts" style={sectionTitle}>{s.yourAttempts}</h3>
        <span style={{ ...TYPE.metadata, color: used >= ATTEMPT_LIMIT ? COLORS.feedback.danger : COLORS.text.tertiary }}>{s.attemptsUsed(used, ATTEMPT_LIMIT)}</span>
      </div>
      <p style={{ ...TYPE.caption, color: COLORS.text.tertiary, margin: '0 0 12px' }}>{s.attemptsHint}</p>

      {misconfigured && (
        <div role="alert" style={{ background: COLORS.feedback.warningSoft, color: COLORS.feedback.warning, borderRadius: RADIUS.input, padding: '10px 12px', marginBottom: '12px', ...TYPE.metadata }}>{s.scoreTypeMissing}</div>
      )}
      {pending && (
        <div role="alert" style={{ background: COLORS.feedback.warningSoft, color: COLORS.feedback.warning, borderRadius: RADIUS.input, padding: '10px 12px', marginBottom: '12px', ...TYPE.metadata }}>
          <div style={{ marginBottom: '8px' }}>{s.pendingSubmission}</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button fullWidth={false} disabled={busy} onClick={() => submitNew(pending.clientAttemptId, pending.fields)} style={{ padding: '8px 12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><RotateCw size={14} /> {busy ? s.submitting : s.pendingRetry}</span>
            </Button>
            <button type="button" disabled={busy} onClick={() => { clearPendingAttempt(memberId, event.id); setPending(null); setError(null) }}
              style={{ ...ghostBtn(false), border: `1px solid ${COLORS.border}` }}>{s.pendingDiscard}</button>
          </div>
        </div>
      )}

      {mine.length === 0 && !mode && <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: '0 0 12px' }}>{s.noAttempts}</p>}

      {mine.length > 0 && (
        <ol style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
          {[...mine].reverse().map((a, i) => {
            const isBest = a.id === bestId
            const deleted = !!a.deleted_at
            return (
              <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${COLORS.divider}`, opacity: deleted ? 0.55 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ ...TYPE.statistics, color: COLORS.text.primary, textDecoration: deleted ? 'line-through' : 'none' }}>{attemptScoreText(a, s)}</span>
                    {isBest && <span style={{ ...TYPE.caption, fontWeight: 700, color: COLORS.brand.contrast, background: COLORS.brand.default, padding: '2px 8px', borderRadius: RADIUS.full, display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Trophy size={11} aria-hidden /> {s.best}</span>}
                    {deleted && <span style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>{s.deleted}</span>}
                  </div>
                  <div style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>{formatDateTime(a.created_at, lang)}{a.notes ? ` · ${a.notes}` : ''}</div>
                </div>
                {!deleted && scoring.open && (
                  <div style={{ display: 'flex', flexShrink: 0 }}>
                    <button type="button" aria-label={`${s.edit} ${attemptScoreText(a, s)}`} disabled={busy}
                      onClick={() => { setError(null); setMode({ kind: 'edit', attempt: a }) }} style={ghostBtn(false)}><Pencil size={14} /> <span>{s.edit}</span></button>
                    <button type="button" aria-label={`${s.delete} ${attemptScoreText(a, s)}`} disabled={busy}
                      onClick={() => setConfirmDelete(a)} style={ghostBtn(true)}><Trash2 size={14} /></button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {mode?.kind === 'new' && (
        <AttemptEditor key={mode.clientAttemptId} event={event} submitLabel={s.submitScore} busy={busy} error={error}
          memberWeightUnit={memberWeightUnit} s={s} t={t}
          onCancel={() => { setMode(null); setError(null) }}
          onSubmit={(fields) => submitNew(mode.clientAttemptId, fields)} />
      )}
      {mode?.kind === 'edit' && (
        <AttemptEditor key={mode.attempt.id} event={event} initialValue={attemptToEditorValue(event, mode.attempt)} submitLabel={s.saveChanges} busy={busy} error={error}
          memberWeightUnit={memberWeightUnit} s={s} t={t}
          onCancel={() => { setMode(null); setError(null) }}
          onSubmit={(fields) => submitEdit(mode.attempt, fields)} />
      )}
      {!mode && error && !pending && <div role="alert" style={{ ...TYPE.metadata, color: COLORS.feedback.danger, marginBottom: '10px' }}>{error}</div>}
      {!mode && canAdd && (
        // A fresh client_attempt_id per genuinely NEW attempt draft.
        <Button onClick={() => { setError(null); setMode({ kind: 'new', clientAttemptId: newClientAttemptId() }) }}>{s.addAttempt}</Button>
      )}
      {!mode && !registered && scoring.open && <p style={{ ...TYPE.caption, color: COLORS.text.tertiary, margin: 0 }}>{s.joinToScore}</p>}

      {confirmDelete && (
        <Modal title={s.deleteConfirmTitle} onClose={() => !busy && setConfirmDelete(null)}>
          <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: '0 0 18px' }}>{s.deleteConfirmText}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button variant="destructive" disabled={busy} onClick={() => doDelete(confirmDelete)}>{busy ? s.submitting : s.deleteConfirm}</Button>
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}
              style={{ padding: '12px', borderRadius: RADIUS.button, border: `1px solid ${COLORS.border}`, background: 'transparent', ...TYPE.button, color: COLORS.text.secondary }}>{s.cancel}</button>
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Best-attempt leaderboard: division tabs + All/Men/Women, ranked by sortSectionLogs. */
export function EventLeaderboard({ event, attempts, membersById, memberId, defaultDivision, s }) {
  const divisions = leaderboardDivisions(event)
  const myDivision = defaultDivision || attempts.find((a) => a.member_id === memberId && !a.deleted_at)?.division
  const [division, setDivision] = useState(myDivision && divisions.includes(myDivision) ? myDivision : divisions[0])
  const [gender, setGender] = useState('all')
  const rows = useMemo(
    () => rankEventLeaderboard(event, attempts, membersById, { division, gender }),
    [event, attempts, membersById, division, gender],
  )
  const othersVisible = event.leaderboard_visible

  return (
    <section style={card} aria-labelledby="event-leaderboard">
      <h3 id="event-leaderboard" style={sectionTitle}>{s.leaderboard}</h3>
      {divisions.length > 1 && (
        <div role="tablist" aria-label={s.division} style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '8px', paddingBottom: '2px' }}>
          {divisions.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={division === d} onClick={() => setDivision(d)} style={chip(division === d)}>{s.divisionLabels[d]}</button>
          ))}
        </div>
      )}
      <div role="group" aria-label="Gender" style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {[['all', s.filterAll], ['male', s.filterMen], ['female', s.filterWomen]].map(([g, label]) => (
          <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)} style={chip(gender === g)}>{label}</button>
        ))}
      </div>
      {!othersVisible && <p style={{ ...TYPE.caption, color: COLORS.text.tertiary, margin: '0 0 8px' }}>{s.leaderboardHidden}</p>}
      {rows.length === 0 ? (
        <p style={{ ...TYPE.body, color: COLORS.text.secondary, margin: 0 }}>{s.leaderboardEmpty}</p>
      ) : (
        <ol aria-label={`${s.leaderboard} ${s.divisionLabels[division] || ''}`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map(({ rank, attempt, member, attemptCount }) => {
            const me = attempt.member_id === memberId
            const name = member?.full_name || member?.email || '—'
            const medal = rank === 1 ? COLORS.ranking.gold : rank === 2 ? COLORS.ranking.silver : rank === 3 ? COLORS.ranking.bronze : null
            return (
              <li key={attempt.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 8px', margin: '0 -8px', borderRadius: '10px', background: me ? COLORS.brand.soft : 'transparent' }}>
                <span style={{ width: '24px', textAlign: 'center', ...TYPE.statistics, color: medal || COLORS.text.tertiary }}>{rank}</span>
                <AvatarCircle name={name} avatarUrl={member?.avatar_url} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...TYPE.bodyStrong, color: COLORS.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}{me ? ` · ${s.you}` : ''}
                  </div>
                  <div style={{ ...TYPE.caption, color: COLORS.text.tertiary }}>
                    {s.attemptsCount(attemptCount)}
                  </div>
                </div>
                <span style={{ ...TYPE.statistics, color: COLORS.text.primary, flexShrink: 0, textAlign: 'right' }}>{attemptScoreText(attempt, s)}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
