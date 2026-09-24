// FORGE DESIGN SYSTEM V1.0 — PHASE 1 (shared component foundations).
// Verifies Button (primary/secondary/destructive, disabled state) and
// WorkoutLevelBadge (color+label pairing, color never the only signal)
// render correctly and use the approved tokens.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Button, WorkoutLevelBadge } from './components'
import { COLORS } from './theme'
import { RADIUS } from './spacing'

afterEach(cleanup)

// jsdom normalizes inline hex colors to rgb() when read back via .style — a
// DOM/test-environment detail, not a component defect. Convert the expected
// token hex the same way so assertions compare like-for-like.
const toRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('Button', () => {
  it('renders children and responds to click', () => {
    let clicked = false
    render(<Button onClick={() => { clicked = true }}>Save</Button>)
    const btn = screen.getByText('Save')
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(clicked).toBe(true)
  })

  it('primary variant uses brand.default fill with brand.contrast text', () => {
    render(<Button variant="primary">Primary</Button>)
    const btn = screen.getByText('Primary')
    expect(btn.style.background).toBe(toRgb(COLORS.brand.default))
    expect(btn.style.color).toBe(toRgb(COLORS.brand.contrast))
  })

  it('secondary variant uses the dark-fill/inverse-text pairing', () => {
    render(<Button variant="secondary">Secondary</Button>)
    const btn = screen.getByText('Secondary')
    expect(btn.style.background).toBe(toRgb(COLORS.interaction.actionSecondary))
    expect(btn.style.color).toBe(toRgb(COLORS.text.inverse))
  })

  it('destructive variant uses the soft-danger fill with text-safe danger text', () => {
    render(<Button variant="destructive">Delete</Button>)
    const btn = screen.getByText('Delete')
    expect(btn.style.background).toBe(toRgb(COLORS.feedback.dangerSoft))
    expect(btn.style.color).toBe(toRgb(COLORS.feedback.danger))
  })

  it('disabled state uses the disabled tokens and is not clickable', () => {
    let clicked = false
    render(<Button disabled onClick={() => { clicked = true }}>Save</Button>)
    const btn = screen.getByText('Save')
    expect(btn).toBeDisabled()
    expect(btn.style.background).toBe(toRgb(COLORS.interaction.disabled))
    expect(btn.style.color).toBe(toRgb(COLORS.text.disabled))
    btn.click()
    expect(clicked).toBe(false)
  })

  it('uses the approved 12px button radius', () => {
    render(<Button>Save</Button>)
    expect(screen.getByText('Save').style.borderRadius).toBe(RADIUS.button)
  })
})

describe('WorkoutLevelBadge', () => {
  it('RX renders the green fill with dark contrast text', () => {
    render(<WorkoutLevelBadge level="rx" label="RX" />)
    const badge = screen.getByText('RX')
    expect(badge.style.background).toBe(toRgb(COLORS.category.rx))
    expect(badge.style.color).toBe(toRgb(COLORS.category.rxContrast))
  })

  it.each([
    ['intermediate', 'Intermediate'],
    ['beginner', 'Beginner'],
    ['onramp', 'OnRamp'],
  ])('%s renders its approved fill with white contrast text', (level, label) => {
    render(<WorkoutLevelBadge level={level} label={label} />)
    const badge = screen.getByText(label)
    expect(badge.style.background).toBe(toRgb(COLORS.category[level]))
    expect(badge.style.color).toBe('rgb(255, 255, 255)')
  })

  it('always renders a text label alongside the color — never renders with no label', () => {
    const { container } = render(<WorkoutLevelBadge level="rx" label="" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for an unknown level rather than a broken/uncolored badge', () => {
    const { container } = render(<WorkoutLevelBadge level="nonexistent" label="???" />)
    expect(container.firstChild).toBeNull()
  })

  it('uses the fully-rounded pill radius', () => {
    render(<WorkoutLevelBadge level="rx" label="RX" />)
    expect(screen.getByText('RX').style.borderRadius).toBe(RADIUS.full)
  })
})
