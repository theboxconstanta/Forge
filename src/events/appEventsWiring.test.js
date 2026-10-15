import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Static wiring checks for App.jsx (no test mounts <App/> - same approach as
// appHookOrderIntegrity / classEditWiring). They pin the EXACT shape of the
// Events integration so a later edit can't silently widen it.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'App.jsx'), 'utf8')

const paywallLine = src.split('\n').find((l) => l.includes('!abonamentActiv && !showOnboarding') && l.includes("screen !== 'catalog'"))

describe('subscription paywall', () => {
  it('keeps every pre-existing condition and adds ONLY the Events exemption', () => {
    expect(paywallLine).toContain("{!isAdmin && abonamentInitialized && claseDBLoaded && rezervariIncarcate && !abonamentActiv && !showOnboarding && screen !== 'abonament' && screen !== 'catalog' && !isEventsPaywallExempt(screen, eventsEnabled) && (")
  })
  it('is the only paywall render site touched', () => {
    expect(src.match(/isEventsPaywallExempt\(/g)).toHaveLength(1)
  })
  it('VIEW EVENTS button exists only while Events is enabled and opens the Events list', () => {
    const i = src.indexOf('t.paywallViewEvents')
    const block = src.slice(src.lastIndexOf('{eventsEnabled && (', i), i)
    expect(block).toContain('onClick={() => openEvents(null)}')
  })
  it('booking / class / logging restrictions are not referenced by the Events wiring', () => {
    const eventsBlock = src.slice(src.indexOf('// FORGE EVENTS (Phase 3). Feature flag'), src.indexOf('if (resetMode) return ('))
    for (const forbidden of ['abonamentActiv', 'rezervari', 'claseDB', 'bookings', 'subscriptions', 'wod_logs']) {
      expect(eventsBlock).not.toContain(forbidden)
    }
  })
})

describe('feature flag gates every entry point', () => {
  it('Events screen renders only when enabled', () => {
    expect(src).toContain('{screen === EVENTS_SCREEN && eventsEnabled && user && userProfile?.gym_id && (')
  })
  it('enabled means a CONFIRMED true', () => {
    expect(src).toContain('const eventsEnabled = eventsFeature.enabled === true')
  })
  it('nav tab is passed the flag', () => {
    expect(src).toContain('eventsEnabled={eventsEnabled} t={t} />')
    expect(src).toContain('const memberTabs = withEventsTab(NAV_TABS, eventsEnabled, EVENTS_NAV_TAB)')
  })
  it('announcements: only when enabled and never over gym-level blocks / onboarding / checkout', () => {
    expect(src).toContain('{eventsEnabled && eventsAnnouncements.current && userProfile?.gym_id')
    expect(src).toContain('&& !gymBlocked && !trialExpired && !noGymMembership && !pendingOwnerBootstrap && !showOnboarding')
    expect(src).toContain('&& !checkoutStatus && !platformCheckoutStatus && (')
    expect(src).toContain('useEventAnnouncements({ enabled: eventsEnabled,')
  })
  it('a flag switched off while on Events sends the member home', () => {
    expect(src).toMatch(/if \(screen === EVENTS_SCREEN && eventsFeature\.enabled === false\) \{\s*clearEventsRoute\(\)\s*setEventsEventId\(null\)\s*setScreen\('home'\)/)
  })
  it('direct navigation is only consumed once the flag is confirmed on', () => {
    expect(src).toMatch(/if \(!user \|\| !eventsEnabled \|\| eventsRouteConsumedRef\.current\) return/)
  })
})
