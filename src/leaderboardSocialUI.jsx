// FORGE — LEADERBOARD SOCIAL INTERACTIONS V1 (UI).
// docs/architecture/LEADERBOARD_SOCIAL_INTERACTIONS_V1_20260921.md
//
// Mounted twice: inside each result card in Clasament (App.jsx) and inside
// ComposerPartLeaderboard's RankedRow (composerLeaderboardUI.jsx) — same
// component, same wod_logs.id, so Overall/Part A/Part B show identical
// interactions for the same result (owner decision §5). Every control here
// calls stopPropagation() — the leaderboard card's own root has an onClick
// that expands/collapses it, and a reaction tap must never trigger that.
//
// REACTION BAR UX FIX: all five reactions render inline, always visible
// (card collapsed or expanded, no separate accordion gate) - tapping one
// resolves immediately via the same V1 add/swap/remove logic. Only the
// "who reacted" list + comment thread stay behind the on-demand panel
// (comment affordance), loaded lazily, one query each, scoped to this
// single wod_log_id. Counts/mine render straight from props already in
// hand (fetchClasament's batched fetch) — no query for the inline bar.

import { useState } from 'react'
import { supabase } from './supabase'
import { resolveMemberIdentity } from './utils'
import { AvatarCircle } from './components'
import {
  LEADERBOARD_REACTION_EMOJI, validateCommentText, relativeTimeLabel,
  commentIsEdited, commentControlsFor,
} from './leaderboardSocial'

function nameOf(identity, t) {
  return identity?.full_name || identity?.email?.split('@')[0] || t?.clasamentAnonymous || 'Anonymous'
}

async function resolveIdentities(ids) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return {}
  const [{ data: profiles }, { data: members }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', uniqueIds),
    supabase.from('members').select('id, full_name, email, avatar_url').in('id', uniqueIds),
  ])
  const profById = {}
  ;(profiles || []).forEach(p => { profById[p.id] = p })
  const memById = {}
  ;(members || []).forEach(m => { memById[m.id] = m })
  const map = {}
  uniqueIds.forEach(id => {
    if (!profById[id] && !memById[id]) return
    map[id] = { id, ...resolveMemberIdentity(memById[id], profById[id]) }
  })
  return map
}

export default function LeaderboardSocialSummary({
  logId, summary, reactorRows, commentCount, onReactionTap, onCommentCountChange,
  user, gymId, isCoachOrAdmin, showToast, t,
}) {
  const [open, setOpen] = useState(false)
  const [panelLoaded, setPanelLoaded] = useState(false)
  const [identities, setIdentities] = useState({})
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const counts = summary?.counts || {}
  const mine = summary?.mine || null
  const totalReactions = Object.values(counts).reduce((a, b) => a + b, 0)

  const loadPanel = async () => {
    const [{ data: commentRows }] = await Promise.all([
      supabase.from('wod_log_comments').select('*').eq('wod_log_id', logId).order('created_at', { ascending: true }),
    ])
    const reactorIds = (reactorRows || []).map(r => r.member_id)
    const commentAuthorIds = (commentRows || []).map(c => c.member_id)
    const identityMap = await resolveIdentities([...reactorIds, ...commentAuthorIds])
    setIdentities(identityMap)
    setComments(commentRows || [])
    setPanelLoaded(true)
  }

  const togglePanel = async (e) => {
    e.stopPropagation()
    const next = !open
    setOpen(next)
    if (next && !panelLoaded) await loadPanel()
  }

  const tapEmoji = (e, emoji) => {
    e.stopPropagation()
    onReactionTap(emoji)
  }

  const postComment = async (e) => {
    e.stopPropagation()
    const v = validateCommentText(commentDraft)
    if (!v.valid || posting) return
    setPosting(true)
    const { data, error } = await supabase.from('wod_log_comments')
      .insert({ wod_log_id: logId, member_id: user.id, gym_id: gymId, text: v.text })
      .select()
      .single()
    setPosting(false)
    if (error) { showToast?.(t?.clasamentCommentPostError || '❌ Error'); console.error(error); return }
    // COMMENT AUTHOR IDENTITY BUG FIX - `identities` is populated once, in
    // loadPanel(), from the comment/reactor rows that existed AT THAT
    // MOMENT. A comment posted locally afterwards (most commonly the
    // poster's own, when they're the first interaction on this result) has
    // a member_id `identities` never saw, so nameOf() fell through to
    // "Anonymous"/generic initials even though ownership (member_id ===
    // user.id) was already correct - that's why Edit/Delete still showed.
    // Feed doesn't hit this because it has no optimistic append at all; it
    // relies on its Realtime subscription to fully refetch (and re-resolve
    // every author's identity from scratch) on every insert. This
    // component deliberately has no Realtime (owner decision, V1 scope),
    // so it merges the poster's own identity in directly via the SAME
    // canonical resolveMemberIdentity path (resolveIdentities, above).
    if (!identities[user.id]) {
      const mine = await resolveIdentities([user.id])
      setIdentities(prev => ({ ...prev, ...mine }))
    }
    setComments(prev => [...prev, data])
    setCommentDraft('')
    onCommentCountChange?.(1)
  }

  const saveEdit = async (e, commentId) => {
    e.stopPropagation()
    const v = validateCommentText(editDraft)
    if (!v.valid) return
    const { data, error } = await supabase.from('wod_log_comments')
      .update({ text: v.text, edited_at: new Date().toISOString() })
      .eq('id', commentId)
      .select()
      .single()
    if (error || !data) { showToast?.(t?.clasamentCommentEditError || '❌ Error'); console.error(error); return }
    setComments(prev => prev.map(c => c.id === commentId ? data : c))
    setEditingId(null)
  }

  const deleteComment = async (e, commentId) => {
    e.stopPropagation()
    const { data, error } = await supabase.from('wod_log_comments').delete().eq('id', commentId).select()
    if (error || !data || data.length === 0) { showToast?.(t?.clasamentCommentDeleteError || '❌ Error'); console.error(error); return }
    setComments(prev => prev.filter(c => c.id !== commentId))
    setConfirmDeleteId(null)
    onCommentCountChange?.(-1)
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f0f0f0' }}>
      {/* REACTION BAR UX FIX - all five reactions inline, always visible
          (collapsed or expanded card), no accordion gate. Tapping an emoji
          resolves immediately via the existing V1 add/swap/remove logic
          (onReactionTap - untouched). Comment count + "who reacted"/comment
          panel stay on-demand, opened via the comment affordance only. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        {LEADERBOARD_REACTION_EMOJI.map(e => (
          <button key={e} onClick={(ev) => tapEmoji(ev, e)}
            style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: counts[e] > 0 ? '3px' : '0', padding: '4px 8px', borderRadius: '14px', lineHeight: 1, cursor: 'pointer', background: mine === e ? '#EFEAF9' : '#f5f5f5', border: mine === e ? '1px solid #5B4B8A' : '1px solid transparent' }}>
            {e}{counts[e] > 0 && <span style={{ fontSize: '11px', fontWeight: '600', color: mine === e ? '#5B4B8A' : '#888' }}>{counts[e]}</span>}
          </button>
        ))}
        <button onClick={togglePanel}
          style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '4px 8px', borderRadius: '14px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', marginLeft: 'auto' }}>
          💬{commentCount > 0 && <span>{commentCount}</span>}
          <span style={{ fontSize: '10px', color: '#ccc' }}>{open ? '▲' : '▼'}</span>
        </button>
      </div>

      {open && (
        <div style={{ marginTop: '10px' }}>
          {totalReactions > 0 && (
            <div style={{ marginBottom: '12px' }}>
              {(reactorRows || []).map((r, i) => (
                <div key={r.member_id + i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <AvatarCircle name={nameOf(identities[r.member_id], t)} avatarUrl={identities[r.member_id]?.avatar_url} size={18} />
                  <span style={{ fontSize: '12px', color: '#555' }}>{nameOf(identities[r.member_id], t)}</span>
                  <span style={{ fontSize: '12px' }}>{r.emoji}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: '10px' }}>
            {comments.map(c => {
              const controls = commentControlsFor(c, user?.id, isCoachOrAdmin)
              const isEditing = editingId === c.id
              return (
                <div key={c.id} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <AvatarCircle name={nameOf(identities[c.member_id], t)} avatarUrl={identities[c.member_id]?.avatar_url} size={20} />
                    <span style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{nameOf(identities[c.member_id], t)}</span>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>{relativeTimeLabel(c.created_at, t)}</span>
                    {commentIsEdited(c) && <span style={{ fontSize: '11px', color: '#ccc' }}>· {t?.clasamentCommentEditedLabel || 'edited'}</span>}
                  </div>
                  {isEditing ? (
                    <div style={{ marginLeft: '26px' }}>
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} maxLength={500}
                        style={{ width: '100%', fontSize: '13px', padding: '6px', borderRadius: '8px', border: '1px solid #eee', resize: 'vertical' }} />
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <button onClick={(e) => saveEdit(e, c.id)} style={{ fontSize: '11px', color: '#5B4B8A', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>{t?.clasamentCommentSaveButton || 'Save'}</button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingId(null) }} style={{ fontSize: '11px', color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>{t?.clasamentCommentCancelButton || 'Cancel'}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '13px', color: '#333', marginLeft: '26px', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                      {(controls.canEdit || controls.canDelete) && (
                        <div style={{ display: 'flex', gap: '10px', marginLeft: '26px', marginTop: '3px' }}>
                          {controls.canEdit && (
                            <button onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditDraft(c.text) }} style={{ fontSize: '11px', color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>{t?.clasamentCommentEditButton || 'Edit'}</button>
                          )}
                          {controls.canDelete && (
                            confirmDeleteId === c.id ? (
                              <button onClick={(e) => deleteComment(e, c.id)} style={{ fontSize: '11px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>{t?.clasamentCommentDeleteConfirm || 'Confirm delete?'}</button>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(c.id) }} style={{ fontSize: '11px', color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>{t?.clasamentCommentDeleteButton || 'Delete'}</button>
                            )
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '8px' }}>
              <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} maxLength={500}
                placeholder={t?.clasamentCommentPlaceholder || 'Write a comment...'} rows={1}
                style={{ flex: 1, fontSize: '13px', padding: '8px', borderRadius: '10px', border: '1px solid #eee', resize: 'vertical' }} />
              <button onClick={postComment} disabled={posting || !commentDraft.trim()}
                style={{ fontSize: '12px', fontWeight: '600', color: '#fff', background: (posting || !commentDraft.trim()) ? '#ccc' : '#0E0E0E', border: 'none', borderRadius: '10px', padding: '8px 12px', cursor: (posting || !commentDraft.trim()) ? 'default' : 'pointer' }}>
                {t?.clasamentCommentSend || 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
