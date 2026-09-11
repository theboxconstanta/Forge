// FORGE VISUAL SYSTEM V2 - PHASE 3 (Track B, B3): single-open exclusivity +
// collapsed-row summary for the in-PWA coach Builder's SectionCard.
//
// Only exercises the CLOSED-section render path (section.open === false) -
// that path never touches PrimarySectionBody/FormatConfigEditor/
// CautareMiscare (see SectionCard's own `{section.open && (...)}` gate), so
// none of those need mocking here; a real, unmodified SectionCard is
// rendered throughout.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SectionCard } from './App.jsx'
import { createSection } from './wodSections.js'

afterEach(cleanup)

const t = {
  wodSectionPrimaryBadge: 'primary section',
  wodSectionScoredBadge: 'scored',
  wiReviewBadge: (n) => `${n} to review`,
}

const sectionTypes = [
  { key: 'warmup', label: 'Warm-up' },
  { key: 'skill', label: 'Skill' },
  { key: 'metcon', label: 'Metcon' },
]

function renderCard(section, overrides = {}) {
  const props = {
    section,
    index: 0,
    total: 1,
    sectionTypes,
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onMakePrimary: vi.fn(),
    onSave: vi.fn(),
    savingWod: false,
    movementCatalog: null,
    t,
    ...overrides,
  }
  render(<SectionCard {...props} />)
  return props
}

describe('SectionCard (Phase 3, B3) - collapsed-row summary', () => {
  it('shows the movement name as a one-line summary on a closed, non-primary section', () => {
    const section = { ...createSection('skill', false), movementName: 'Snatch', open: false }
    renderCard(section)
    expect(screen.getByText('Snatch')).toBeInTheDocument()
  })

  it('shows the workout name as a one-line summary on a closed primary section', () => {
    const section = { ...createSection('metcon', true), name: 'Fran', open: false }
    renderCard(section)
    expect(screen.getByText('Fran')).toBeInTheDocument()
  })

  it('shows no summary line for a Warm-up section (no movementName field in the domain)', () => {
    const section = { ...createSection('warmup', false), open: false }
    renderCard(section)
    expect(screen.getByText('Warm-up')).toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
  })

  it('shows the free-text content (not the collapsed summary span) once a Warm-up section is open', () => {
    const section = { ...createSection('warmup', false), text: '10 min row', open: true }
    renderCard(section)
    expect(screen.getByDisplayValue('10 min row')).toBeInTheDocument()
  })
})

describe('SectionCard (Phase 3, B3) - exclusive open/close', () => {
  it('calls onToggleOpen (not onChange) when the header is clicked, if provided', () => {
    const onToggleOpen = vi.fn()
    const section = { ...createSection('warmup', false), open: false }
    const props = renderCard(section, { onToggleOpen })
    fireEvent.click(screen.getByText('Warm-up'))
    expect(onToggleOpen).toHaveBeenCalledTimes(1)
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('falls back to the existing onChange({ open }) toggle when onToggleOpen is not provided (back-compat)', () => {
    const section = { ...createSection('warmup', false), open: false }
    const props = renderCard(section)
    fireEvent.click(screen.getByText('Warm-up'))
    expect(props.onChange).toHaveBeenCalledWith({ open: true })
  })

  it('the chevron toggle also routes through onToggleOpen', () => {
    const onToggleOpen = vi.fn()
    const section = { ...createSection('warmup', false), open: false }
    renderCard(section, { onToggleOpen })
    fireEvent.click(screen.getByText('▼'))
    expect(onToggleOpen).toHaveBeenCalledTimes(1)
  })
})
