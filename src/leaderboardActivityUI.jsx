// FORGE — LEADERBOARD ACTIVITY V1 (personal social notifications, UI).
// Compact "ACTIVITY" entry point inside the Leaderboard screen (owner
// decision: no separate full-screen system, no notification bell — the
// existing Leaderboard nav icon + a numeric badge is the entry point,
// wired in App.jsx's NavBar call). Self-contained: fetches its own list +
// resolves actor identities lazily on open, same convention
// LeaderboardSocialSummary already uses for reactors/comments (reused,
// not duplicated — see the imports below).

import { useState } from 'react'
import { supabase } from './supabase'
import { AvatarCircle } from './components'
import { resolveIdentities, nameOf } from './leaderboardMemberIdentity'
import { relativeTimeLabel } from './leaderboardSocial'
import { isUnread, notificationMessage } from './leaderboardActivity'

export default function LeaderboardActivityPanel({ unreadCount, onUnreadCountChange, user, showToast, onNavigateToLog, t }) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [identities, setIdentities] = useState({})

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('leaderboard_notifications')
      .select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(50)
    setLoading(false)
    if (error) { showToast?.(t?.clasamentActivityLoadError || '❌ Error'); console.error(error); return }
    const rows = data || []
    setNotifications(rows)
    setIdentities(await resolveIdentities(rows.map(n => n.actor_id)))
    setLoaded(true)
  }

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && !loaded) await load()
  }

  const markAllRead = async () => {
    const { error } = await supabase.from('leaderboard_notifications')
      .update({ read_at: new Date().toISOString() }).eq('recipient_id', user.id).is('read_at', null)
    if (error) { showToast?.(t?.clasamentActivityMarkReadError || '❌ Error'); console.error(error); return }
    const now = new Date().toISOString()
    setNotifications(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }))
    onUnreadCountChange?.(0)
  }

  const tapNotification = async (n) => {
    if (isUnread(n)) {
      const now = new Date().toISOString()
      const { error } = await supabase.from('leaderboard_notifications').update({ read_at: now }).eq('id', n.id)
      if (!error) {
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read_at: now } : x))
        onUnreadCountChange?.(prev => Math.max(0, (prev || 0) - 1))
      }
    }
    onNavigateToLog(n.wod_log_id, n.kind)
  }

  return (
    <div style={{ marginBottom: '14px' }}>
      <button onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #f0f0f0', background: '#fff', cursor: 'pointer' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#0E0E0E', letterSpacing: '0.05em' }}>{t?.clasamentActivityTitle || 'ACTIVITY'}</span>
        {unreadCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '18px', height: '18px', borderRadius: '9px', background: '#E8192C', color: '#fff', fontSize: '11px', fontWeight: '600', padding: '0 5px' }}>
            {unreadCount}
          </span>
        )}
        <span style={{ fontSize: '11px', color: '#ccc', marginLeft: 'auto' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: '8px', background: '#fff', borderRadius: '12px', border: '1px solid #f0f0f0', padding: '10px 14px' }}>
          {loading && <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '10px' }}>{t?.clasamentLoading || 'Loading...'}</div>}
          {!loading && notifications.length === 0 && (
            <div style={{ fontSize: '12px', color: '#bbb', textAlign: 'center', padding: '10px' }}>{t?.clasamentActivityEmpty || 'No activity yet'}</div>
          )}
          {!loading && notifications.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
                <button onClick={markAllRead} disabled={unreadCount === 0}
                  style={{ fontSize: '11px', fontWeight: '600', color: unreadCount === 0 ? '#ccc' : '#5B4B8A', background: 'none', border: 'none', cursor: unreadCount === 0 ? 'default' : 'pointer' }}>
                  {t?.clasamentActivityMarkAllRead || 'Mark all as read'}
                </button>
              </div>
              {notifications.map(n => {
                const unread = isUnread(n)
                const identity = identities[n.actor_id]
                return (
                  <div key={n.id} onClick={() => tapNotification(n)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 6px', borderRadius: '10px', cursor: 'pointer', background: unread ? '#F7F5FC' : 'transparent', marginBottom: '4px' }}>
                    <AvatarCircle name={nameOf(identity, t)} avatarUrl={identity?.avatar_url} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: '#0E0E0E', fontWeight: unread ? '600' : '500', lineHeight: 1.4 }}>
                        {notificationMessage(n, nameOf(identity, t), t)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>{relativeTimeLabel(n.created_at, t)}</div>
                    </div>
                    {unread && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#5B4B8A', flexShrink: 0, marginTop: '5px' }} />}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
