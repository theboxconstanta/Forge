// P9.5 — Movement icon-family identity resolution (presentation metadata only).
//
// P9.5.1 (owner acceptance): the icon COMPONENT was removed from Log WOD (icons
// didn't look good). This resolver + movementIconMap.json + the integrity test
// are retained as a harmless, tested catalog artifact — a deterministic
// canonicalMovementId -> semantic-family classification for a possible future
// non-Log-WOD surface. Nothing in production consumes it today.
//
// resolveMovementIconKey is IDENTITY-FIRST: canonicalMovementId -> map ->
// iconKey. No runtime fuzzy name matching (name matching was used ONCE, offline,
// to seed the map). No id / not in map -> 'OTHER'. It NEVER influences
// capability / identity / scoring / logging / snapshot / RX / leaderboard.

import ICON_MAP from './movementIconMap.json'

export const ICON_KEYS = [
  'BARBELL', 'DUMBBELL', 'KETTLEBELL', 'WALL_BALL', 'ROWER', 'BIKE', 'SKIERG',
  'RUN', 'CARDIO_OTHER', 'JUMP_ROPE', 'ROPE', 'BOX', 'CARRY', 'SLED', 'SANDBAG',
  'RINGS', 'GHD', 'BENCH', 'GYMNASTICS', 'BODYWEIGHT', 'OTHER',
]
export const ICON_KEY_SET = new Set(ICON_KEYS)

/** Identity-first icon-family resolution. Accepts a movement instance
 * (`{ canonicalMovementId }`), a bare id string, or null. Always returns a
 * valid ICON_KEY — never undefined. */
export function resolveMovementIconKey(instanceOrId) {
  const id = typeof instanceOrId === 'string'
    ? instanceOrId
    : (instanceOrId && instanceOrId.canonicalMovementId) || null
  if (id && Object.prototype.hasOwnProperty.call(ICON_MAP, id)) {
    const k = ICON_MAP[id]
    if (ICON_KEY_SET.has(k)) return k
  }
  return 'OTHER'
}

export { ICON_MAP }
