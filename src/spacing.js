// Forge Visual System v1 — SPACING & RADIUS TOKENS.
//
// Companion to theme.js (COLORS) and typography.js (TYPE). Plain exported
// constants, same adoption model as the other two: defining these changes
// nothing at runtime until a call site references them, and migration is
// incremental, not a sweeping replacement.
//
// Design System V1.0 (owner-approved) — the hybrid, current-value-preserving
// direction: core spacing steps at 4/8/12/16/24px (chosen to collapse the
// app's existing ad hoc cluster of 4/6/8/10/12/14/16/20px onto the closest
// approved step, not to invent new spacing), with 32px permitted between
// major page sections. Radius keeps the app's two most common existing
// values (10px folded to the nearest approved step is NOT the same value —
// see note on `md` below) plus a `full` step for pills/badges, which already
// account for 41 existing uses of a fully-rounded shape.

export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  // Between major sections only (e.g. one card group and the next), not a
  // general-purpose step — most layouts should reach for `lg`/`xl` first.
  section: '32px',
}

export const RADIUS = {
  // Inputs and buttons — approved geometry, Design System V1.0.
  input: '12px',
  button: '12px',
  // Cards — approved geometry, Design System V1.0.
  card: '16px',
  // Pills, badges, and other fully-rounded shapes.
  full: '999px',
}

export default { SPACING, RADIUS }
