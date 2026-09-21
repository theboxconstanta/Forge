// FORGE — shared member-identity resolution for the Leaderboard's social
// surfaces (reactors/comment authors, Activity notification actors).
// Split out of leaderboardSocialUI.jsx so it can be reused by
// leaderboardActivityUI.jsx without a second implementation ("do not
// create duplicate infrastructure") AND without breaking that component
// file's fast-refresh contract (a component file should only export
// components). Same canonical resolveMemberIdentity convention (utils.js)
// every other member-identity lookup in this app already uses - members
// canonical, profiles legacy fallback.

import { supabase } from './supabase'
import { resolveMemberIdentity } from './utils'

export function nameOf(identity, t) {
  return identity?.full_name || identity?.email?.split('@')[0] || t?.clasamentAnonymous || 'Anonymous'
}

export async function resolveIdentities(ids) {
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
