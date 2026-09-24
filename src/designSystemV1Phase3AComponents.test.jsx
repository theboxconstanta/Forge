// FORGE DESIGN SYSTEM V1.0 — PHASE 3A (shared component foundations).
// Verifies Select, Input, StatusBadge, EmptyState, and Card (prepared but not
// yet wired into any live screen, per owner instruction — Phase 3B) render
// correctly and use the approved tokens.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Select, Input, StatusBadge, EmptyState, Card } from './components'
import { COLORS } from './theme'
import { RADIUS } from './spacing'
import { Users } from 'lucide-react'

afterEach(cleanup)

const toRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('Select', () => {
  it('renders its children options and responds to change', () => {
    let value = 'RX'
    render(
      <Select value={value} onChange={e => { value = e.target.value }}>
        <option>RX</option><option>Intermediate</option>
      </Select>
    )
    expect(screen.getByText('RX')).toBeInTheDocument()
    expect(screen.getByText('Intermediate')).toBeInTheDocument()
  })

  it('uses the approved 12px input radius and standard border/background tokens', () => {
    const { container } = render(<Select value="RX" onChange={() => {}}><option>RX</option></Select>)
    const el = container.querySelector('select')
    expect(el.style.borderRadius).toBe(RADIUS.input)
    expect(el.style.background).toBe(toRgb(COLORS.surface.subtle))
  })

  it('disabled state uses the disabled text token', () => {
    const { container } = render(<Select value="RX" onChange={() => {}} disabled><option>RX</option></Select>)
    const el = container.querySelector('select')
    expect(el).toBeDisabled()
    expect(el.style.color).toBe(toRgb(COLORS.text.disabled))
  })
})

describe('Input', () => {
  it('forwards value/onChange/placeholder like a plain input', () => {
    render(<Input value="hello" onChange={() => {}} placeholder="Name" readOnly />)
    expect(screen.getByPlaceholderText('Name')).toHaveValue('hello')
  })

  it('uses the approved 12px input radius and standard border/background tokens', () => {
    render(<Input value="" onChange={() => {}} placeholder="x" />)
    const el = screen.getByPlaceholderText('x')
    expect(el.style.borderRadius).toBe(RADIUS.input)
    expect(el.style.background).toBe(toRgb(COLORS.surface.subtle))
    expect(el.style.border).toBe(`1px solid ${toRgb(COLORS.border)}`)
  })

  it('forwards type and other native attributes', () => {
    render(<Input type="email" value="" onChange={() => {}} placeholder="Email" />)
    expect(screen.getByPlaceholderText('Email')).toHaveAttribute('type', 'email')
  })
})

describe('StatusBadge', () => {
  it('renders the label and never renders with no label — color is never the only signal', () => {
    const { container } = render(<StatusBadge tone="danger" label="" />)
    expect(container.firstChild).toBeNull()
  })

  it('danger tone uses the soft-danger background with text-safe danger text', () => {
    render(<StatusBadge tone="danger" label="Admin" />)
    const badge = screen.getByText('Admin')
    expect(badge.style.background).toBe(toRgb(COLORS.feedback.dangerSoft))
    expect(badge.style.color).toBe(toRgb(COLORS.feedback.danger))
  })

  it('falls back to the neutral tone for an unrecognized tone', () => {
    render(<StatusBadge tone="not-a-real-tone" label="X" />)
    const badge = screen.getByText('X')
    expect(badge.style.background).toBe(toRgb(COLORS.surface.subtle))
  })

  it('uses the fully-rounded pill radius', () => {
    render(<StatusBadge tone="info" label="Info" />)
    expect(screen.getByText('Info').style.borderRadius).toBe(RADIUS.full)
  })
})

describe('EmptyState', () => {
  it('renders the message using the accessible tertiary text token', () => {
    render(<EmptyState message="No results found" />)
    const el = screen.getByText('No results found')
    expect(el.style.color).toBe(toRgb(COLORS.text.tertiary))
  })

  it('renders an optional icon when provided', () => {
    const { container } = render(<EmptyState icon={Users} message="No clients" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders no icon element when none is provided', () => {
    const { container } = render(<EmptyState message="No results found" />)
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('Card (prepared only — not yet wired into any live screen, Phase 3B)', () => {
  it('renders children at the approved 16px radius with no default shadow', () => {
    const { container } = render(<Card>content</Card>)
    const el = container.firstChild
    expect(el.style.borderRadius).toBe(RADIUS.card)
    expect(el.style.boxShadow).toBe('none')
    expect(el.style.borderStyle).toBe('none')
  })

  it('bordered opt-in adds a subtle 1px border', () => {
    const { container } = render(<Card bordered>content</Card>)
    expect(container.firstChild.style.border).toBe(`1px solid ${toRgb(COLORS.border)}`)
  })

  it('elevated opt-in adds the theme shadow token, not a literal', () => {
    const { container } = render(<Card elevated>content</Card>)
    expect(container.firstChild.style.boxShadow).toBe(COLORS.shadow.sm)
  })
})
