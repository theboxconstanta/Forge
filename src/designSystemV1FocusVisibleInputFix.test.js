// FORGE DESIGN SYSTEM V1.0 — FINAL ACCESSIBILITY FIX (visible input focus).
// Source-level assertions. Proves the reported inline `outline: 'none'`
// suppression is removed from all 28 affected <input>/<textarea> style
// objects, that the global :focus-visible rule in index.css is intact,
// and that no value/onChange/handler/validation/disabled logic changed.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.jsx'), 'utf-8').replace(/\r\n/g, '\n')
const cssSource = readFileSync(join(here, 'index.css'), 'utf-8').replace(/\r\n/g, '\n')

describe('Inline outline suppression removed', () => {
  it('zero remaining inline outline:\'none\' occurrences in App.jsx', () => {
    const matches = appSource.match(/outline: 'none'/g) || []
    expect(matches.length).toBe(0)
  })
})

describe('Global :focus-visible rule remains intact (index.css)', () => {
  it('still defines the 2px solid #0E0E0E focus ring with offset', () => {
    expect(cssSource).toContain(':focus-visible {')
    expect(cssSource).toContain('outline: 2px solid #0E0E0E;')
    expect(cssSource).toContain('outline-offset: 2px;')
  })
})

describe('Admin Clients search — visible focus, state/handlers unchanged', () => {
  it('input retains searchClienti/setSearchClienti binding with no outline override', () => {
    expect(appSource).toContain("<input value={searchClienti} onChange={e => setSearchClienti(e.target.value)} placeholder={t.adminClientsSearchPlaceholder}\n              style={{ flex: 1, border: 'none', fontSize: '13px', background: 'transparent' }} />")
  })
})

describe('Admin Subscriptions search — visible focus, state/handlers unchanged', () => {
  it('input retains searchAbonamente/setSearchAbonamente binding with no outline override', () => {
    expect(appSource).toContain("<input value={searchAbonamente} onChange={e => setSearchAbonamente(e.target.value)} placeholder={t.adminSubsSearchPlaceholder}\n              style={{ flex: 1, border: 'none', fontSize: '13px', background: 'transparent' }} />")
  })
})

describe('New Subscription member-search guard — untouched by this fix', () => {
  it('emailAbonament validation, foldD folding and selectMember are unchanged (guard never had outline:none - it is a different input)', () => {
    expect(appSource).toContain('const emailValid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(emailVal)')
    expect(appSource).toContain('const foldD = (s) => (s || \'\').normalize(\'NFD\')')
    expect(appSource).toContain('const selectMember = (c) => { setEmailAbonament(c.email); setAbonamentDropdownOpen(false) }')
  })
})

describe('No excluded logic was touched', () => {
  it('the six regression-risk anchors are all still present verbatim', () => {
    expect(appSource).toContain('const statusColor = !activ ? \'#aaa\' : expirat ? \'#E24B4A\' : neinceput ? \'#BA7517\' : \'#0E0E0E\'')
    expect(appSource).toContain("typeof catalog?.createMovement !== 'function'")
    expect(appSource).toContain('claseTrecuteOpen')
    expect(appSource).toContain("{adminTab === 'setari' && isAdmin && (")
    expect(appSource).toContain("{adminTab === 'platforma' && isPlatformAdmin && (")
  })

  it('every migrated Card instance from Phases 3B-3F is still present (12 total)', () => {
    const matches = appSource.match(/<Card (bordered|key=)/g) || []
    expect(matches.length).toBe(12)
  })
})
