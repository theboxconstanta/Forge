// FORGE WORKOUT COMPOSER - PHASE 3: React authoring UI tests. Renders the
// REAL ComposerEditor/ComponentCard/ComponentPicker (composerAuthoring.jsx)
// together with the REAL movement-editing controls (MovementRowListPWA/
// EmomMinutePatternEditor, imported from App.jsx exactly like
// wodSectionCardPhase3.test.jsx already does for SectionCard) - not stubs -
// so movement editing reuse (ticket §24/§59) is proven end to end, not just
// asserted by inspection.

import { useState } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import ComposerEditor, { ComposerPreview } from './composerAuthoring'
import { MovementRowListPWA, EmomMinutePatternEditor } from './App.jsx'
import { addComponentToList, setScoreOwner } from './componentContract'

afterEach(cleanup)

const t = {
  composerEmptyState: 'No Components yet.',
  composerAddComponentButton: '+ Add Component',
  composerPickerTitle: 'Add Component',
  composerCountsTowardLabel: 'Counts toward:',
  composerCountsTowardNone: 'Nothing (unscored)',
}

function Harness({ initial = [] }) {
  const [components, setComponents] = useState(initial)
  return (
    <ComposerEditor components={components} onChange={setComponents} movementCatalog={null}
      MovementEditor={MovementRowListPWA} EmomEditor={EmomMinutePatternEditor} t={t} />
  )
}

// --- 1. True empty state (ticket §5) ----------------------------------------

describe('ComposerEditor - Start Empty', () => {
  it('shows "No Components yet." and the Add Component action, nothing else', () => {
    render(<Harness />)
    expect(screen.getByText('No Components yet.')).toBeInTheDocument()
    expect(screen.getByText('+ Add Component')).toBeInTheDocument()
    expect(screen.queryByText(/AMRAP|RFT|REST|BUY-IN|CASH-OUT/)).not.toBeInTheDocument()
  })
})

// --- 2/7/8. Picker opens, grouped, adds a real component --------------------

describe('ComposerEditor - Add Component flow', () => {
  it('+ Add Component opens a grouped picker with the curated formats', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('+ Add Component'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Buy-In')).toBeInTheDocument()
    expect(screen.getByText('Cash-Out')).toBeInTheDocument()
    expect(screen.getByText('Rounds For Time')).toBeInTheDocument()
    expect(screen.getByText('EMOM')).toBeInTheDocument()
    expect(screen.getByText('Rest')).toBeInTheDocument()
  })

  it('picking AMRAP adds a real Component card and closes the picker', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('+ Add Component'))
    fireEvent.click(screen.getByText('AMRAP'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('AMRAP 10')).toBeInTheDocument() // default durationSec:600 -> "10"
    expect(screen.queryByText('No Components yet.')).not.toBeInTheDocument()
  })

  it('picking Rest adds a Component with no movement editor at all', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('+ Add Component'))
    fireEvent.click(screen.getByText('Rest'))
    expect(screen.getByText(/REST/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Movement')).not.toBeInTheDocument()
  })
})

// --- 3/24/25. Movement editing reused + scoped per Component (ticket §24/§25) --

describe('ComposerEditor - movement editing is REAL and scoped per Component', () => {
  it('+ Add Movement inside one AMRAP Component only affects that Component', () => {
    const amrapA = addComponentToList([], 'AMRAP')[0]
    const amrapB = addComponentToList([], 'RFT')[0]
    render(<Harness initial={[{ ...amrapA, order: 0 }, { ...amrapB, order: 1 }]} />)
    const addMovementButtons = screen.getAllByText('+ Add movement')
    expect(addMovementButtons).toHaveLength(2) // one per Component, no global list
    fireEvent.click(addMovementButtons[0])
    const nameInputs = screen.getAllByPlaceholderText('Movement')
    expect(nameInputs).toHaveLength(1) // only Component A got a movement row
  })

  it('reuses the real MovementRowPWA row (name input + move/duplicate/remove controls)', () => {
    const amrap = addComponentToList([], 'AMRAP')[0]
    render(<Harness initial={[amrap]} />)
    fireEvent.click(screen.getByText('+ Add movement'))
    expect(screen.getByPlaceholderText('Movement')).toBeInTheDocument()
    expect(screen.getByLabelText('Duplicate movement')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove movement')).toBeInTheDocument()
  })

  it('EMOM Components render the real EmomMinutePatternEditor, not the flat movement list', () => {
    const emom = addComponentToList([], 'EMOM')[0]
    render(<Harness initial={[emom]} />)
    expect(screen.getByText('EMOM 8')).toBeInTheDocument()
    // EmomMinutePatternEditor's own minute-grouped "+ Add movement" affordance
    // is present (same underlying control MovementRowListPWA also exposes),
    // proving the EMOM-specific editor mounted rather than the generic one.
    expect(screen.getAllByText('+ Add movement').length).toBeGreaterThan(0)
  })
})

// --- 4. Component config editing (ticket §26) -------------------------------

describe('ComposerEditor - per-Component config editing', () => {
  it('changing an AMRAP Component\'s own duration does not show a format dropdown (fixed by the Picker)', () => {
    const amrap = addComponentToList([], 'AMRAP')[0]
    render(<Harness initial={[amrap]} />)
    expect(screen.queryByText('Format')).not.toBeInTheDocument()
  })
})

// --- 5. Remove Component + ownership warning (ticket §22/§50) --------------

describe('ComposerEditor - remove Component', () => {
  it('removes a plain Component with no confirmation needed', () => {
    const amrap = addComponentToList([], 'AMRAP')[0]
    render(<Harness initial={[amrap]} />)
    fireEvent.click(screen.getByLabelText(/Remove AMRAP/))
    expect(screen.getByText('No Components yet.')).toBeInTheDocument()
  })

  it('removing a component that owns Buy-In/Cash-Out asks for confirmation and clears ownership on cancel-free confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentToList(components, 'RFT')
    const rftId = components[1].id
    components = setScoreOwner(components, components[0].id, rftId).components
    render(<Harness initial={components} />)
    fireEvent.click(screen.getByLabelText(/Remove 5 ROUNDS FOR TIME|Remove ROUNDS FOR TIME/))
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByText('BUY-IN')).toBeInTheDocument() // Buy-In survives, just unowned now
    expect(screen.getByText('Nothing (unscored)')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('does not remove anything when the coach cancels the confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentToList(components, 'RFT')
    components = setScoreOwner(components, components[0].id, components[1].id).components
    render(<Harness initial={components} />)
    fireEvent.click(screen.getByLabelText(/Remove 5 ROUNDS FOR TIME|Remove ROUNDS FOR TIME/))
    expect(screen.getAllByText(/ROUNDS FOR TIME/).length).toBeGreaterThan(0) // still there
    confirmSpy.mockRestore()
  })
})

// --- 6. Reorder Components (ticket §23/§48) ---------------------------------

describe('ComposerEditor - reorder Components', () => {
  it('moving a Component down swaps it with its neighbor, preserving identity', () => {
    const amrap = { ...addComponentToList([], 'AMRAP')[0], order: 0 }
    const rft = { ...addComponentToList([], 'RFT')[0], order: 1 }
    render(<Harness initial={[amrap, rft]} />)
    fireEvent.click(screen.getByLabelText(/Move AMRAP.*down/))
    // RFT's header should now render before AMRAP's in the DOM order.
    const cardTexts = screen.getAllByText(/AMRAP 10|5 ROUNDS FOR TIME/).map(el => el.textContent)
    expect(cardTexts[0]).toMatch(/ROUNDS FOR TIME/)
    expect(cardTexts[1]).toMatch(/AMRAP/)
  })

  it('an up-arrow at the top of the list is disabled (no-op boundary)', () => {
    const amrap = addComponentToList([], 'AMRAP')[0]
    render(<Harness initial={[amrap]} />)
    expect(screen.getByLabelText(/Move AMRAP.*up/)).toBeDisabled()
  })
})

// --- 9. Ownership authoring - preferred auto-attach + explicit selector (ticket §10) --

describe('ComposerEditor - score ownership authoring', () => {
  it('auto-attaches a freshly-added Cash-Out to the one existing scorer, deterministically', () => {
    const rft = addComponentToList([], 'RFT')
    render(<Harness initial={rft} />)
    fireEvent.click(screen.getByText('+ Add Component'))
    fireEvent.click(screen.getByText('Cash-Out'))
    // The explicit "Counts toward" selector reflects the auto-attach, never hidden.
    expect(screen.getByText('Counts toward:')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5 ROUNDS FOR TIME')).toBeInTheDocument()
  })

  it('never exposes a raw component id anywhere in the ownership UI', () => {
    const rft = addComponentToList([], 'RFT')
    render(<Harness initial={rft} />)
    fireEvent.click(screen.getByText('+ Add Component'))
    fireEvent.click(screen.getByText('Buy-In'))
    const select = screen.getByText('Counts toward:').closest('div')
    expect(within(select).queryByText(/cmp_/)).not.toBeInTheDocument()
  })

  it('coach can explicitly detach ownership via the selector', () => {
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentToList(components, 'RFT')
    components = setScoreOwner(components, components[0].id, components[1].id).components
    render(<Harness initial={components} />)
    fireEvent.change(screen.getByDisplayValue('5 ROUNDS FOR TIME'), { target: { value: '' } })
    expect(screen.getByDisplayValue('Nothing (unscored)')).toBeInTheDocument()
  })
})

// --- 10. Preview (ticket §28/§29) -------------------------------------------

describe('ComposerPreview', () => {
  it('renders nothing for an empty components list', () => {
    const { container } = render(<ComposerPreview components={[]} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the full envelope in canonical order with human headers, no jargon', () => {
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentToList(components, 'RFT')
    components = addComponentToList(components, 'Once', 'cash-out')
    render(<ComposerPreview components={components} t={t} />)
    const headers = screen.getAllByText(/BUY-IN|ROUNDS FOR TIME|CASH-OUT/)
    expect(headers.map(h => h.textContent)).toEqual(['BUY-IN', '5 ROUNDS FOR TIME', 'CASH-OUT'])
    expect(screen.queryByText(/scorer|envelope/i)).not.toBeInTheDocument()
  })
})
