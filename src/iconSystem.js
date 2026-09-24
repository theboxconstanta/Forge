// Forge Visual System v1 — ICON SIZE & STROKE TOKENS.
//
// Companion to theme.js/typography.js/spacing.js. Lucide (lucide-react) is
// the approved icon family app-wide (Design System V1.0). These constants
// define the approved sizes/stroke — they do NOT change any existing icon's
// rendered size on their own; call sites adopt them incrementally, the same
// migration model as the other token files.
//
// Design System V1.0 (owner-approved): active-state icons must NOT rely on a
// heavier stroke as the primary signal (the member bottom nav's current
// 2 / 2.5 inactive/active split is superseded by this) — color and
// background treatment carry active state instead, stroke stays uniform.

export const ICON_SIZE = {
  primaryNav: 22, // member bottom nav (Home/Log/PRs/Leaderboard/Feed/Admin)
  adminNav: 20,   // Admin's internal tab row — was 13px, unspecified stroke
  action: 20,     // buttons, inline actions
  decorative: 18, // non-interactive icons beside text (16-18px approved range; 18 is the default pick)
}

export const ICON_STROKE = 2 // uniform across every context — no separate active-state weight
