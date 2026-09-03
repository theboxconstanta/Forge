// Forge Visual System v1 — SEMANTIC COLOR TOKENS.
//
// Companion to typography.js (TYPE). Plain exported constants, referenced at
// call sites the same way the rest of this codebase is organised — NO context
// provider, NO CSS-in-JS library, NO runtime theming, NO dark mode. Introduced
// by "Forge Visual System v1 — Stage 0 + Stage 1": infrastructure + invisible
// literal consolidation only. Values below are the owner-accepted baseline from
// the Color System Audit; consolidating near-duplicate literals onto them is a
// perceptually-null change.
//
// NOT owner-approved yet, and therefore intentionally NOT given values here:
//   - category.rx / category.intermediate / category.beginner / category.onramp
//   - avatar colour treatment
// A final visual decision on those is deferred to a later stage. `category.mixed`
// keeps its already-consistent shipped values.
//
// Tokens defined but NOT migrated in Stage 1 (feedback, brand.ink, interaction
// .focus, etc.) are here for Stage 2+ adoption — they change nothing at runtime
// until a call site references them.

export const COLORS = {
  // ---- Surfaces -----------------------------------------------------------
  surface: {
    background: '#FFFFFF', // page ground (mirrors index.css)
    default:    '#FFFFFF', // cards, sheets, modals
    subtle:     '#FAFAFA', // input fills, nested panels  <- #f8f8f8 / #f9f9f9 / #F7F7F5
  },

  // ---- Text -------------------------------------------------------------
  text: {
    primary:   '#0E0E0E', // <- #111111 / #1A1A1A / #222 / #333 / #2E2E2E (ink only)
    secondary: '#555555', // <- #666
    muted:     '#8A8A8A', // <- #888 / #aaa / #999 / #9A9A9A / #9CA3AF / #bbb  (Stage 3)
    inverse:   '#FFFFFF', // text/icon on a dark fill
  },

  // ---- Structure -------------------------------------------------------
  border:  '#E0E0E0', // inputs, chips, cards  <- #E4E4E4 / #ECECEC / #ddd / #eee / #ccc
  divider: '#F0F0F0', // row hairlines inside a card  <- #F3F4F6

  // ---- Brand ----------------------------------------------------------
  brand: {
    default:  '#ABE73C', // accent fills — buttons, toggle-on, today badge
    soft:     '#F3FBE0', // accent tint background
    contrast: '#0E0E0E', // text/icon ON a brand fill
    ink:      '#4A6B12', // brand-coloured TEXT on white (#ABE73C as text is 1.4:1) — Stage 2+
    onDark:   '#B7E63A', // the brighter green the NavBar uses on the #0E0E0E bar
  },

  // ---- Interaction --------------------------------------------------
  interaction: {
    actionPrimary:   '#ABE73C', // = brand.default (fill) + brand.contrast (label)
    actionSecondary: '#0E0E0E', // dark fill + text.inverse
    disabled:        '#E0E0E0', // one mechanism — fill #E0E0E0 / text #8A8A8A  (Stage 4)
    focus:           '#0E0E0E', // 2px outline ring  (Stage 4 — NOT applied yet)
  },

  // ---- Feedback (defined; migrated in Stage 4) ---------------------
  feedback: {
    success:     '#1E6B36',
    successSoft: '#E7F6EA',
    successBorder: '#BFE6C8',
    warning:     '#BA7517',
    warningSoft: '#FBEEDB', // audit value — distinct from category.intermediate.soft
    danger:      '#C0392B', // text — 4.9:1, AA
    dangerSolid: '#E24B4A', // solid fills / large icons
    dangerSoft:  '#FCEBEB',
    dangerBorder:'#F0C0C0',
    info:        '#3B6FB5',
    infoSoft:    '#EEF2FF',
  },

  // ---- Ranking -----------------------------------------------------
  ranking: {
    gold:   '#D4AF37',
    silver: '#A8A8A8', // <- also #B0B0B0 (primary-LB card rail)
    bronze: '#CD7F32',
  },

  // ---- Workout categories ---------------------------------------
  // rx / intermediate / beginner / onramp: NOT owner-approved — no values here.
  // Do not consolidate category rendering onto this object until the palette
  // is signed off (Visual System v1, Stage 5).
  category: {
    mixed:     '#5B4B8A', // existing shipped value — already the only one in use
    mixedSoft: '#EFEAF9',
  },

  // ---- Elevation (shadow, not a grey fill) --------------------
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.06)',
    md: '0 2px 10px rgba(0,0,0,0.10)',
  },
}

export default COLORS
