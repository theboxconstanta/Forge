// Forge Visual System v1 — SEMANTIC COLOR TOKENS.
//
// Companion to typography.js (TYPE) and spacing.js (SPACING/RADIUS). Plain
// exported constants, referenced at call sites the same way the rest of this
// codebase is organised — NO context provider, NO CSS-in-JS library, NO
// runtime theming, NO dark mode. Introduced by "Forge Visual System v1 —
// Stage 0 + Stage 1": infrastructure + invisible literal consolidation only.
// Values below are the owner-accepted baseline from the Color System Audit;
// consolidating near-duplicate literals onto them is a perceptually-null
// change.
//
// Stage 5 (Design System V1.0, owner-approved): `category.rx/intermediate/
// beginner/onramp` given final values below. Workout level is always paired
// with the badge's text label — color is never the sole signal.
//
// Accessibility correction (Design System V1.0 Final Specification): three
// existing tokens measured below WCAG AA (4.5:1) for normal-size text,
// verified via the WCAG relative-luminance formula, not estimated:
//   - text.muted (#8A8A8A) — 3.45:1. Restricted to large text (>=24px) or
//     non-text/decorative use; text.tertiary (new, below) is the accessible
//     replacement for small meaningful text.
//   - feedback.dangerSolid (#E24B4A) — 3.93:1. Stays valid for solid fills,
//     borders and large text ONLY; feedback.danger (#C0392B, 5.44:1,
//     unchanged) is the correct token for normal-size error TEXT.
//   - feedback.warning (#BA7517) — 3.72:1, fails. Renamed to warningSolid
//     (kept, valid for fills/borders/large text) and replaced below by an
//     accessible warning value for text use. Semantics unchanged — still the
//     warning-severity color, only the text-safe hex differs.
//
// Tokens defined but NOT migrated in Stage 1 (interaction.focus etc.) are
// here for later adoption — they change nothing at runtime until a call site
// references them.

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
    muted:     '#8A8A8A', // 3.45:1 on white — fails AA for normal text. Large text (>=24px) or non-text/decorative use only.
    tertiary:  '#6B6B6B', // 5.33:1 on white — the accessible token for small meaningful text (captions, metadata) that used to reach for `muted`.
    disabled:  '#A3A3A3', // paired with interaction.disabled as background. WCAG exempts inactive controls from the text-contrast criterion — chosen for legibility, not to hit 4.5:1.
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
    warning:     '#8C5A17', // text-safe — 5.85:1 on white (AA). Was #BA7517 (3.72:1, failed) — see warningSolid.
    warningSolid:'#BA7517', // the original value — valid for solid fills/borders/large text only, not normal-size text
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
  // Stage 5 (Design System V1.0, owner-approved). One canonical token per
  // level, kept separate from feedback.* status colors — same hue family as
  // brand/status is coincidental where it occurs (e.g. rx = brand.default),
  // never a re-use of the status token itself. Each level's `contrast` is
  // the text color for its own badge fill, computed via WCAG relative
  // luminance (RX's green fails as white text — 1.48:1 — so it takes dark
  // text like brand.contrast; the other three pass with white text at
  // 5.02–5.70:1). Badge label + color together always carry level identity —
  // never color alone.
  category: {
    rx:            '#ABE73C', // = brand.default
    rxContrast:    '#0E0E0E', // dark text on the RX badge — 13.08:1
    intermediate:      '#2563EB', // 5.17:1 as text on white
    intermediateContrast: '#FFFFFF', // white text on the Intermediate badge — 5.17:1
    beginner:          '#B45309', // 5.02:1 as text on white
    beginnerContrast:  '#FFFFFF', // white text on the Beginner badge — 5.02:1
    onramp:            '#7C3AED', // 5.70:1 as text on white
    onrampContrast:    '#FFFFFF', // white text on the OnRamp badge — 5.70:1
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
