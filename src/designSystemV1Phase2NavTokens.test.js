// FORGE DESIGN SYSTEM V1.0 — PHASE 2 (Admin nav + bottom nav icon tokens).
// Proves ICON_SIZE/ICON_STROKE (iconSystem.js) are actually applied at the
// two real navigation call sites in App.jsx, not just defined in the token
// file. Source-level assertion rather than a component render test, since
// neither Admin() nor App() (the member shell) can be rendered in isolation
// here — both pull in the full Supabase-backed app tree. Also confirms the
// Admin tab row's structural requirements from owner decision A: one row,
// no wrapping, label always rendered (not conditional on selection), and
// the pre-existing role-gated filter predicate is untouched.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'App.jsx'), 'utf-8')

describe('Admin nav (horizontal scroll, owner decision A)', () => {
  it('the tab icon uses ICON_SIZE.adminNav and ICON_STROKE, not a hardcoded size/stroke', () => {
    expect(source).toContain('<tab.icon size={ICON_SIZE.adminNav} strokeWidth={ICON_STROKE}')
  })

  it('the old hardcoded 13px icon size is gone from the tab row', () => {
    expect(source).not.toContain('<tab.icon size={13}')
  })

  it('the label is unconditionally rendered — no longer only-when-selected', () => {
    // the old conditional label render this replaces
    expect(source).not.toContain('{adminTab === tab.id ? ` ${tab.lbl}` : \'\'}')
  })

  it('the scroll container is single-row, no-wrap, horizontally scrollable', () => {
    expect(source).toMatch(/overflowX: 'auto', flexWrap: 'nowrap'/)
  })

  it('each tab meets the 44px minimum touch-target height', () => {
    expect(source).toMatch(/data-admin-tab=\{tab\.id\}[\s\S]{0,200}minHeight: '44px'/)
  })

  it('the pre-existing role-gated filter predicate is untouched', () => {
    expect(source).toContain("filter(tab => (!tab.adminOnly || isAdmin) && (!tab.platformOnly || isPlatformAdmin) && (!tab.ownerOnly || isOwner))")
  })

  it('the active tab auto-scrolls into view on adminTab change', () => {
    expect(source).toContain('data-admin-tab="${adminTab}"')
    expect(source).toContain("scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })")
  })

  it('edge-fade overlays are conditional on actual overflow, not a fixed decoration', () => {
    expect(source).toContain('adminTabsOverflow.left &&')
    expect(source).toContain('adminTabsOverflow.right &&')
  })
})

describe('Member bottom nav (uniform stroke, owner-approved icon spec)', () => {
  it('uses ICON_SIZE.primaryNav and a uniform ICON_STROKE, not the old 2.5/2 active-state split', () => {
    expect(source).toContain('<Icon size={ICON_SIZE.primaryNav} strokeWidth={ICON_STROKE} color={isActive ? \'#B7E63A\' : \'#9CA3AF\'} />')
  })

  it('the old stroke-width-as-active-signal is gone', () => {
    expect(source).not.toContain('strokeWidth={isActive ? 2.5 : 2}')
  })

  it('active state is still signaled by color — the distinguishing mechanism is preserved, not removed', () => {
    expect(source).toMatch(/color=\{isActive \? '#B7E63A' : '#9CA3AF'\}/)
  })
})

describe('token file wiring', () => {
  it('App.jsx imports ICON_SIZE/ICON_STROKE from the Phase 1 token file, not a re-declared local copy', () => {
    expect(source).toContain("import { ICON_SIZE, ICON_STROKE } from './iconSystem'")
  })
})
