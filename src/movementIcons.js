// P9.5 — Movement icon identity resolution (presentation only).
//
// resolveMovementIconKey is IDENTITY-FIRST: canonicalMovementId ->
// movementIconMap.json -> iconKey. No runtime fuzzy name matching (name
// matching was used ONCE, offline, to seed the map). A movement with no id /
// not in the map -> 'OTHER' (the required generic fallback).
//
// Icons NEVER influence capability / identity / scoring / logging / snapshot /
// RX / leaderboard / analytics (owner directive §4 / §20).

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
