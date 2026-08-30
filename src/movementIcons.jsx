// P9.5 — <MovementIcon>: ~20 semantic-family line icons + OTHER fallback.
// Simple line icons, 24×24, stroke="currentColor", one stroke family.
// lucide-react (already a dependency) supplies Dumbbell + Bike; the
// CrossFit-specific glyphs are small inline SVGs. Presentation only.
//
// resolveMovementIconKey / ICON_KEYS live in ./movementIcons.js (no JSX) so the
// identity resolver is importable without pulling in React.

import { Dumbbell as LucideDumbbell, Bike as LucideBike } from 'lucide-react'
import { ICON_KEY_SET } from './movementIcons.js'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

const GLYPHS = {
  BARBELL: (
    <>
      <circle cx="5" cy="12" r="2.6" {...S} />
      <circle cx="19" cy="12" r="2.6" {...S} />
      <path d="M7.6 12h8.8M3 9.5v5M21 9.5v5" {...S} />
    </>
  ),
  KETTLEBELL: (
    <>
      <path d="M9 7.5a3 3 0 0 1 6 0" {...S} />
      <path d="M8.6 8.2C6 9.4 5 12 5 14.5A4.5 4.5 0 0 0 9.5 19h5A4.5 4.5 0 0 0 19 14.5c0-2.5-1-5.1-3.6-6.3" {...S} />
    </>
  ),
  WALL_BALL: (
    <>
      <circle cx="12" cy="14.5" r="5" {...S} />
      <path d="M12 9.5V3M9.5 5.5 12 3l2.5 2.5" {...S} />
    </>
  ),
  ROWER: (
    <>
      <path d="M4 18l6-4M14 10l6-4" {...S} />
      <circle cx="12" cy="12" r="2" {...S} />
      <path d="M4 6h3M17 18h3" {...S} />
    </>
  ),
  SKIERG: (
    <>
      <path d="M8 3v13M16 3v13" {...S} />
      <path d="M6 16h4l-2 5zM14 16h4l-2 5z" {...S} />
    </>
  ),
  RUN: (
    <>
      <circle cx="15" cy="5.5" r="1.8" {...S} />
      <path d="M13 9l-3 3 2 3-1 5M10 12l-4-1M13 9l4 2 3-1" {...S} />
    </>
  ),
  CARDIO_OTHER: (
    <path d="M3 12h4l2-5 3 10 2-7 2 4h5" {...S} />
  ),
  JUMP_ROPE: (
    <>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" {...S} />
      <circle cx="6" cy="3.5" r="1.3" {...S} />
      <circle cx="18" cy="3.5" r="1.3" {...S} />
    </>
  ),
  ROPE: (
    <path d="M12 3c-3 2 3 4 0 6s3 4 0 6 3 4 0 6" {...S} />
  ),
  BOX: (
    <>
      <path d="M5 20V11l7-3 7 3v9z" {...S} />
      <path d="M5 11l7 3 7-3M12 14v6" {...S} />
    </>
  ),
  CARRY: (
    <>
      <circle cx="12" cy="4.5" r="1.8" {...S} />
      <path d="M12 7v9M7 16v4M17 16v4M9 10h6M6 12v4M18 12v4" {...S} />
    </>
  ),
  SLED: (
    <>
      <path d="M5 16h11v3H5zM7 16v-4h7v4" {...S} />
      <path d="M16 14l5-3" {...S} />
    </>
  ),
  SANDBAG: (
    <path d="M8 6h8l2 4v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7zM6 10h12M9 6V4h6v2" {...S} />
  ),
  RINGS: (
    <>
      <path d="M8 3v5M16 3v5" {...S} />
      <circle cx="8" cy="13" r="4" {...S} />
      <circle cx="16" cy="13" r="4" {...S} />
    </>
  ),
  GHD: (
    <>
      <path d="M3 10h13a3 3 0 0 1 3 3a3 3 0 0 1-3 3H8" {...S} />
      <path d="M6 16v4M15 16v4M19 13h2" {...S} />
    </>
  ),
  BENCH: (
    <>
      <path d="M3 10h18v3H3z" {...S} />
      <path d="M5 13v7M19 13v7M5 17h14" {...S} />
    </>
  ),
  GYMNASTICS: (
    <>
      <path d="M4 5h16M6 5v3M18 5v3" {...S} />
      <circle cx="12" cy="10.5" r="1.8" {...S} />
      <path d="M12 12.3V17M12 14l-3 2M12 14l3 2M12 17l-2 4M12 17l2 4" {...S} />
    </>
  ),
  BODYWEIGHT: (
    <>
      <circle cx="12" cy="5" r="2" {...S} />
      <path d="M12 7.5v6M12 9l-4 2M12 9l4 2M12 13.5l-3 6M12 13.5l3 6" {...S} />
    </>
  ),
  OTHER: (
    <circle cx="12" cy="12" r="7" {...S} />
  ),
}

/** Decorative movement icon. `aria-hidden` by default — the movement name is
 * always the accessible label right next to it. */
export function MovementIcon({ iconKey, size = 22, style }) {
  const key = ICON_KEY_SET.has(iconKey) ? iconKey : 'OTHER'
  if (key === 'DUMBBELL') return <LucideDumbbell size={size} strokeWidth={1.6} style={style} aria-hidden />
  if (key === 'BIKE') return <LucideBike size={size} strokeWidth={1.6} style={style} aria-hidden />
  return <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden focusable="false">{GLYPHS[key]}</svg>
}
