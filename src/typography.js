// Forge App-Wide Typography System (FORGE_APP_WIDE_TYPOGRAPHY_SYSTEM_REPORT.md)
// Single source of truth for the app's typography scale, modeled on btwb's
// iOS proportions - compact, airy, restrained. Each export is a ready-to-spread
// inline style fragment: style={{ ...TYPO.pageTitle, color: '#111111' }}.
// Weights are limited to 400/500/600 everywhere except where noted.
//
// ---------------------------------------------------------------------------
// LEGACY. `TYPO` is the pre-v1 scale. Its remaining call sites (mostly
// `...TYPO.pageTitle`) are being migrated to the `TYPE` roles by the Visual
// System v1 typography stages. Stage 3 brought `pageTitle` onto the approved
// PAGE TITLE role (20 / 600). New code uses `TYPE` (below).
// ---------------------------------------------------------------------------
export const TYPO = {
  // Display / month titles ("August 2026", "July 02")
  display: { fontSize: '24px', fontWeight: '600', lineHeight: '28px', letterSpacing: '-0.02em' },

  // Page titles ("Leaderboard", "Membership", "Profile", "Workout")
  // Visual System v1 Stage 3: 22 -> 20 to match the approved PAGE TITLE role.
  // Tightens the top-of-screen hierarchy so the page title reads as a title,
  // not a display headline. Size only — weight and metrics unchanged.
  pageTitle: { fontSize: '20px', fontWeight: '600' },

  // Section labels ("TODAY", "MONDAY", "WORKOUT OF THE DAY", "PARTICIPANTS")
  sectionLabel: { fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.08em' },

  // Primary content (class names, workout titles, movement names, membership
  // names, leaderboard row names)
  primary: { fontSize: '16px', fontWeight: '500' },

  // Secondary content (coach names, dates, subtitles, descriptions, notes, metadata)
  secondary: { fontSize: '13px', fontWeight: '400', lineHeight: '18px' },

  // Numeric values (times, occupancy, sessions, RON, kg, days left)
  numeric: { fontSize: '14px', fontWeight: '500', fontVariantNumeric: 'tabular-nums' },
  // Important numeric values may step up to 16px Medium
  numericLarge: { fontSize: '16px', fontWeight: '500', fontVariantNumeric: 'tabular-nums' },

  // Calendar
  calendarWeekday: { fontSize: '11px', fontWeight: '500' },
  calendarDayNumber: { fontSize: '18px', fontWeight: '500', fontVariantNumeric: 'tabular-nums' },
  calendarMonthAbbrev: { fontSize: '11px', fontWeight: '400' },

  // Time badge (black square) - badge itself unchanged, text only
  timeBadge: { fontSize: '14px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' },

  // Buttons
  buttonPrimary: { fontSize: '15px', fontWeight: '500' },
  buttonSecondary: { fontSize: '14px', fontWeight: '500' },

  // Inputs
  inputText: { fontSize: '15px', fontWeight: '400' },

  // Navigation
  navBottom: { fontSize: '11px', fontWeight: '500' },
  navTop: { fontSize: '13px', fontWeight: '500' },
}

// ===========================================================================
// Forge Visual System v1 — SEMANTIC TYPE ROLES  (companion to theme.js COLORS)
//
// The owner-accepted v1 baseline. Same spread-fragment pattern as TYPO:
//   style={{ ...TYPE.cardTitle, color: COLORS.text.primary }}
//
// 11 roles, down from TYPO's 20 + ~11 ad-hoc inline sizes. Weight axis is
// 400 / 500 / 600 ONLY (700 retired). Two tracking values total. Every role
// that can wrap carries an explicit lineHeight.
//
// Stage 0 introduces these definitions. Stage 0/1 does NOT migrate any call
// site to them (the weight pass is Stage 2; the size/lineHeight rollout is
// Stage 3). Nothing references TYPE yet — defining it changes nothing at
// runtime.
// ===========================================================================
export const TYPE = {
  // Home big date, month titles, paywall headline. (The 80px timer countdown
  // stays a documented one-off outside the scale.)
  display: { fontSize: '26px', fontWeight: '600', lineHeight: 1.15, letterSpacing: '-0.02em' },

  // "Leaderboard", "Membership", "Profile", "Workout"
  pageTitle: { fontSize: '20px', fontWeight: '600', lineHeight: 1.2, letterSpacing: '-0.01em' },

  // "TODAY", "PARTICIPANTS", "YOUR SCORE", "WORKOUT OF THE DAY", category headers
  sectionTitle: { fontSize: '12px', fontWeight: '600', lineHeight: 1.3, letterSpacing: '0.06em', textTransform: 'uppercase' },

  // class name, workout title, member name, movement name, plan name,
  // Journal card title, modal title
  cardTitle: { fontSize: '16px', fontWeight: '600', lineHeight: 1.3 },

  // leaderboard score, benchmark PR value, the big result number — the anchor,
  // one step above cardTitle
  score: { fontSize: '18px', fontWeight: '600', lineHeight: 1, fontVariantNumeric: 'tabular-nums' },

  // descriptions, coach names, notes, movement sub-lines, modal body, prose
  body: { fontSize: '14px', fontWeight: '400', lineHeight: 1.5 },

  // expanded-detail values, "N runde + M" result, inline emphasis inside body
  bodyStrong: { fontSize: '14px', fontWeight: '600', lineHeight: 1.4 },

  // every primary & secondary button (primary vs secondary is a COLOUR
  // distinction, not a type one)
  button: { fontSize: '14px', fontWeight: '600', lineHeight: 1, letterSpacing: '0.01em' },

  // field labels (VARIANT / WEIGHT / RESULT), metric labels, "ADDITIONAL REPS"
  label: { fontSize: '11px', fontWeight: '600', lineHeight: 1.2, letterSpacing: '0.05em', textTransform: 'uppercase' },

  // timestamps, participant counts, dates, "coached by", schedule lines, status
  metadata: { fontSize: '12px', fontWeight: '500', lineHeight: 1.35 },

  // finest print — "for time" / "AMRAP" tag, prescribed-weight suffix, disclaimers
  caption: { fontSize: '11px', fontWeight: '400', lineHeight: 1.35 },
}
