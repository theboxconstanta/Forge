// Forge App-Wide Typography System (FORGE_APP_WIDE_TYPOGRAPHY_SYSTEM_REPORT.md)
// Single source of truth for the app's typography scale, modeled on btwb's
// iOS proportions - compact, airy, restrained. Each export is a ready-to-spread
// inline style fragment: style={{ ...TYPO.pageTitle, color: '#111111' }}.
// Weights are limited to 400/500/600 everywhere except where noted.

export const TYPO = {
  // Display / month titles ("August 2026", "July 02")
  display: { fontSize: '24px', fontWeight: '600', lineHeight: '28px', letterSpacing: '-0.02em' },

  // Page titles ("Leaderboard", "Membership", "Profile", "Workout")
  pageTitle: { fontSize: '22px', fontWeight: '600' },

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
