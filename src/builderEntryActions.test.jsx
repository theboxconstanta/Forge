// FORGE BUILDER ENTRY UX - Start Empty as primary action (narrow pass).
//
// Behavioral regression tests for the extracted BuilderEntryActions
// component (App.jsx) - proves the action hierarchy (Start Empty primary,
// Analyze with AI / Use Template secondary) and that every handler still
// fires exactly the prop it was given (Admin wires these directly to its
// own unchanged startEmptyWod/analyzeWorkout/useTemplateWod - not
// re-tested here, since BuilderEntryActions owns no logic of its own).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BuilderEntryActions } from './App.jsx'

afterEach(cleanup)

const t = {
  adminWodQuickCreateTitle: 'Create workout',
  adminWodQuickCreateSubtitle: 'Paste a workout, write an idea, or ask AI to generate one.',
  adminWodQuickCreatePlaceholder: 'For time...',
  adminWodQuickCreateGenerateButton: 'Analyze with AI',
  adminWodQuickCreateGenerateButtonLoading: 'Analyzing...',
  adminWodQuickCreateTemplateButton: 'Use Template',
  adminWodQuickCreateEmptyButton: 'Start Empty',
  adminWodQuickCreateFooter: 'Paste from CAP, Mayhem, CompTrain, BTWB, TrainHeroic, Notes, WhatsApp, or anywhere.',
}

function renderActions(overrides = {}) {
  const props = {
    aiParseText: '',
    onAiParseTextChange: vi.fn(),
    aiAnalyzing: false,
    onStartEmpty: vi.fn(),
    onAnalyze: vi.fn(),
    onUseTemplate: vi.fn(),
    t,
    ...overrides,
  }
  render(<BuilderEntryActions {...props} />)
  return props
}

describe('BuilderEntryActions - action hierarchy', () => {
  it('renders Start Empty, Analyze with AI, and Use Template, with no duplicates', () => {
    renderActions()
    expect(screen.getAllByText('Start Empty')).toHaveLength(1)
    expect(screen.getAllByText('Analyze with AI')).toHaveLength(1)
    expect(screen.getAllByText('Use Template')).toHaveLength(1)
  })

  it('places Start Empty before the secondary actions in DOM order', () => {
    renderActions()
    const buttons = screen.getAllByRole('button').map(b => b.textContent)
    const startIdx = buttons.indexOf('Start Empty')
    const analyzeIdx = buttons.indexOf('Analyze with AI')
    const templateIdx = buttons.indexOf('Use Template')
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(startIdx).toBeLessThan(analyzeIdx)
    expect(startIdx).toBeLessThan(templateIdx)
  })

  it('gives Start Empty the canonical FORGE V2 lime primary treatment, full width', () => {
    renderActions()
    const btn = screen.getByText('Start Empty')
    expect(btn.style.background).toBe('rgb(171, 231, 60)') // #ABE73C
    expect(btn.style.color).toBe('rgb(14, 14, 14)') // #0E0E0E
    expect(btn.style.width).toBe('100%')
  })
})

describe('BuilderEntryActions - handler wiring (unchanged behavior)', () => {
  it('Start Empty calls onStartEmpty', () => {
    const props = renderActions()
    fireEvent.click(screen.getByText('Start Empty'))
    expect(props.onStartEmpty).toHaveBeenCalledTimes(1)
  })

  it('Analyze with AI calls onAnalyze when text is present', () => {
    const props = renderActions({ aiParseText: '5 rounds of 10 pull-ups' })
    fireEvent.click(screen.getByText('Analyze with AI'))
    expect(props.onAnalyze).toHaveBeenCalledTimes(1)
  })

  it('Use Template calls onUseTemplate', () => {
    const props = renderActions()
    fireEvent.click(screen.getByText('Use Template'))
    expect(props.onUseTemplate).toHaveBeenCalledTimes(1)
  })

  it('typing in the paste textarea calls onAiParseTextChange (AI input unchanged)', () => {
    const props = renderActions()
    fireEvent.change(screen.getByPlaceholderText('For time...'), { target: { value: 'Fran' } })
    expect(props.onAiParseTextChange).toHaveBeenCalledWith('Fran')
  })
})

describe('BuilderEntryActions - existing disabled/loading behavior preserved', () => {
  it('Analyze with AI is disabled when the paste text is empty', () => {
    renderActions({ aiParseText: '' })
    expect(screen.getByText('Analyze with AI').disabled).toBe(true)
  })

  it('Analyze with AI is enabled once text is present', () => {
    renderActions({ aiParseText: 'Fran' })
    expect(screen.getByText('Analyze with AI').disabled).toBe(false)
  })

  it('shows the loading label and disables all three actions while aiAnalyzing', () => {
    renderActions({ aiParseText: 'Fran', aiAnalyzing: true })
    expect(screen.getByText('Analyzing...').disabled).toBe(true)
    expect(screen.getByText('Start Empty').disabled).toBe(true)
    expect(screen.getByText('Use Template').disabled).toBe(true)
  })

  it('Use Template is enabled (independent of paste text) when not analyzing', () => {
    renderActions({ aiParseText: '' })
    expect(screen.getByText('Use Template').disabled).toBe(false)
  })
})
