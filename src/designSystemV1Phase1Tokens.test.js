// FORGE DESIGN SYSTEM V1.0 — PHASE 1 (token layer). Verifies the exact
// owner-approved values landed in theme.js/spacing.js/iconSystem.js/
// typography.js, and that the accessibility corrections (text-safe warning,
// tertiary text, disabled text) are present without silently deleting the
// original values they supersede (warningSolid, muted) — per the ticket's
// explicit "do not silently replace the existing warning token" instruction.

import { describe, it, expect } from 'vitest'
import { COLORS } from './theme'
import { SPACING, RADIUS } from './spacing'
import { ICON_SIZE, ICON_STROKE } from './iconSystem'
import { TYPE } from './typography'

describe('workout-level colors (Design System V1.0, owner-approved)', () => {
  it('each level has its approved hex', () => {
    expect(COLORS.category.rx).toBe('#ABE73C')
    expect(COLORS.category.intermediate).toBe('#2563EB')
    expect(COLORS.category.beginner).toBe('#B45309')
    expect(COLORS.category.onramp).toBe('#7C3AED')
  })

  it('RX badge uses dark contrast text; the other three use white', () => {
    expect(COLORS.category.rxContrast).toBe('#0E0E0E')
    expect(COLORS.category.intermediateContrast).toBe('#FFFFFF')
    expect(COLORS.category.beginnerContrast).toBe('#FFFFFF')
    expect(COLORS.category.onrampContrast).toBe('#FFFFFF')
  })

  it('rx equals brand.default — one canonical green, not a duplicate literal', () => {
    expect(COLORS.category.rx).toBe(COLORS.brand.default)
  })

  it('workout-level colors stay distinct objects from feedback status colors', () => {
    expect(COLORS.category.intermediate).not.toBe(COLORS.feedback.info)
    expect(COLORS.category.beginner).not.toBe(COLORS.feedback.warning)
    expect(COLORS.category.beginner).not.toBe(COLORS.feedback.warningSolid)
  })
})

describe('accessibility token corrections', () => {
  it('feedback.warning is corrected to the text-safe value; the original is preserved as warningSolid, not deleted', () => {
    expect(COLORS.feedback.warning).toBe('#8C5A17')
    expect(COLORS.feedback.warningSolid).toBe('#BA7517')
    expect(COLORS.feedback.warning).not.toBe(COLORS.feedback.warningSolid)
  })

  it('feedback.danger (text-safe) is unchanged; dangerSolid is preserved for fills/borders/large text', () => {
    expect(COLORS.feedback.danger).toBe('#C0392B')
    expect(COLORS.feedback.dangerSolid).toBe('#E24B4A')
  })

  it('text.tertiary is the new accessible small-text gray; text.muted is preserved, not deleted', () => {
    expect(COLORS.text.tertiary).toBe('#6B6B6B')
    expect(COLORS.text.muted).toBe('#8A8A8A')
  })

  it('text.disabled exists, paired conceptually with interaction.disabled as background', () => {
    expect(COLORS.text.disabled).toBe('#A3A3A3')
    expect(COLORS.interaction.disabled).toBe('#E0E0E0')
  })
})

describe('spacing and radius (Design System V1.0, owner-approved hybrid scale)', () => {
  it('core spacing steps are 4/8/12/16/24px', () => {
    expect(SPACING.xs).toBe('4px')
    expect(SPACING.sm).toBe('8px')
    expect(SPACING.md).toBe('12px')
    expect(SPACING.lg).toBe('16px')
    expect(SPACING.xl).toBe('24px')
  })

  it('major-section gap is 32px', () => {
    expect(SPACING.section).toBe('32px')
  })

  it('component radii match the approved geometry', () => {
    expect(RADIUS.input).toBe('12px')
    expect(RADIUS.button).toBe('12px')
    expect(RADIUS.card).toBe('16px')
    expect(RADIUS.full).toBe('999px')
  })
})

describe('icon system (Lucide, Design System V1.0)', () => {
  it('sizes match the approved values per context', () => {
    expect(ICON_SIZE.primaryNav).toBe(22)
    expect(ICON_SIZE.adminNav).toBe(20)
    expect(ICON_SIZE.action).toBe(20)
    expect(ICON_SIZE.decorative).toBeGreaterThanOrEqual(16)
    expect(ICON_SIZE.decorative).toBeLessThanOrEqual(18)
  })

  it('stroke width is uniform at 2px — no separate active-state weight', () => {
    expect(ICON_STROKE).toBe(2)
  })
})

describe('typography — completed TYPE scale', () => {
  it('navBottom/navTop are ported from the legacy TYPO values, not re-derived', () => {
    expect(TYPE.navBottom.fontSize).toBe('11px')
    expect(TYPE.navBottom.fontWeight).toBe('500')
    expect(TYPE.navTop.fontSize).toBe('13px')
    expect(TYPE.navTop.fontWeight).toBe('500')
  })

  it('a timer role exists for the fullscreen countdown, tabular numerals', () => {
    expect(TYPE.timer.fontSize).toBe('80px')
    expect(TYPE.timer.fontVariantNumeric).toBe('tabular-nums')
  })

  it('a statistics role exists, tabular numerals', () => {
    expect(TYPE.statistics.fontVariantNumeric).toBe('tabular-nums')
  })
})
