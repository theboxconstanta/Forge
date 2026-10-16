import { describe, it, expect, beforeEach } from 'vitest'
import {
  isEventsPaywallExempt, withEventsTab, readEventsRoute, persistEventsRoute, clearEventsRoute, stripEventsParamsFromUrl,
} from './eventsNavigation'

const ID = '3f0c1e2a-9b8d-4c7e-a6f5-1234567890ab'

describe('paywall exemption is Events-only', () => {
  it('only the Events screen, only when enabled', () => {
    expect(isEventsPaywallExempt('events', true)).toBe(true)
    expect(isEventsPaywallExempt('events', false)).toBe(false)
    expect(isEventsPaywallExempt('events', null)).toBe(false)
  })
  it('every other screen stays restricted', () => {
    for (const screen of ['home', 'log', 'logWOD', 'logSkill', 'pr', 'logPR', 'clasament', 'feed', 'profile', 'timer', 'admin', 'abonament', 'catalog']) {
      expect(isEventsPaywallExempt(screen, true)).toBe(false)
    }
  })
})

describe('nav tab', () => {
  const tabs = [{ id: 'home' }, { id: 'log' }, { id: 'pr' }, { id: 'clasament' }, { id: 'feed' }]
  const events = { id: 'events' }
  it('inserted right after Feed when enabled', () => {
    expect(withEventsTab(tabs, true, events).map((t) => t.id)).toEqual(['home', 'log', 'pr', 'clasament', 'feed', 'events'])
  })
  it('absent when disabled or unknown; input never mutated', () => {
    expect(withEventsTab(tabs, false, events)).toBe(tabs)
    expect(withEventsTab(tabs, null, events)).toBe(tabs)
    expect(tabs).toHaveLength(5)
  })
})

describe('direct navigation + refresh survival', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/') })
  it('?event=<uuid> opens that event; ?events opens the list', () => {
    expect(readEventsRoute(`?event=${ID}`)).toEqual({ eventId: ID, fromUrl: true })
    expect(readEventsRoute('?events')).toEqual({ eventId: null, fromUrl: true })
  })
  it('ignores malformed ids', () => {
    expect(readEventsRoute('?event=not-a-uuid')).toBeNull()
  })
  it('a persisted route survives a reload; clearing forgets it', () => {
    persistEventsRoute(ID)
    expect(readEventsRoute('')).toEqual({ eventId: ID, fromUrl: false })
    persistEventsRoute(null)
    expect(readEventsRoute('')).toEqual({ eventId: null, fromUrl: false })
    clearEventsRoute()
    expect(readEventsRoute('')).toBeNull()
  })
  it('strips only the events params from the URL', () => {
    window.history.replaceState({}, '', `/?event=${ID}&lang=en`)
    stripEventsParamsFromUrl()
    expect(window.location.search).toBe('?lang=en')
  })
})
