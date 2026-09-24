// FORGE DESIGN SYSTEM V1.0 — PHASE 3E (three-card migration).
// Source-level assertions, same approach as Phase 3B/3D: proves exactly the
// three owner-approved cards (Admin -> Clients search bar, Admin ->
// Subscriptions search bar, Admin -> Platform Signup Codes) now render
// through the shared Card component, that their handlers/state/conditional
// rendering/permission gating are unchanged, and that no excluded card
// family or the New Subscription form's member-search guard was touched.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'App.jsx'), 'utf-8').replace(/\r\n/g, '\n')

describe('Admin Clients search bar — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper, with compact padding (not the 20px default)', () => {
    expect(source).toContain("<Card bordered style={{ padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>\n            <span style={{ fontSize: '16px' }}>\u{1F50D}</span>\n            <input value={searchClienti} onChange={e => setSearchClienti(e.target.value)} placeholder={t.adminClientsSearchPlaceholder}")
  })

  it('preserves searchClienti/setSearchClienti and the existing list + tab-count filtering', () => {
    expect(source).toContain(".filter(c => !searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase()))")
    expect(source).toContain("{ id: 'toti', lbl: t.adminClientsFilterAll, count: clienti.filter(c => !searchClienti ||")
  })

  it('does NOT touch the New Subscription form or its member-search selected-email guard', () => {
    expect(source).toContain('const foldD = (s) => (s || \'\').normalize(\'NFD\')')
    expect(source).toContain('const selectMember = (c) => { setEmailAbonament(c.email); setAbonamentDropdownOpen(false) }')
  })
})

describe('Admin Subscriptions search bar — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper, with compact padding (not the 20px default)', () => {
    expect(source).toContain("<Card bordered style={{ padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>\n            <span style={{ fontSize: '16px' }}>\u{1F50D}</span>\n            <input value={searchAbonamente} onChange={e => setSearchAbonamente(e.target.value)} placeholder={t.adminSubsSearchPlaceholder}")
  })

  it('preserves searchAbonamente/setSearchAbonamente and its independent list filtering', () => {
    expect(source).toContain('const searchQ = foldDiacritics(searchAbonamente.trim())')
  })

  it('remains independent of searchClienti (no shared state between the two search bars)', () => {
    const clientsFilter = source.match(/searchClienti/g) || []
    const subsFilter = source.match(/searchAbonamente/g) || []
    expect(clientsFilter.length).toBeGreaterThan(0)
    expect(subsFilter.length).toBeGreaterThan(0)
    // neither identifier appears inside the other's declaration/usage lines combined
    expect(source).not.toContain('searchClienti = searchAbonamente')
    expect(source).not.toContain('searchAbonamente = searchClienti')
  })
})

describe('Admin Platform Signup Codes — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper with standard 20px padding', () => {
    expect(source).toContain("<Card bordered style={{ padding: '20px', marginTop: '14px' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '14px' }}>{t.platformAdminCodesTitle}</div>")
  })

  it('preserves the generateSignupCode handler and generatingSignupCode disabled state', () => {
    expect(source).toContain('<Button variant="secondary" onClick={generateSignupCode} disabled={generatingSignupCode} style={{ marginBottom: \'14px\' }}>')
  })

  it('preserves empty-state and populated used/unused rendering, unchanged', () => {
    expect(source).toContain('{signupCodes.length === 0 ? (')
    expect(source).toContain('{t.platformAdminNoCodes}')
    expect(source).toContain('{c.used_at ? `${t.platformAdminUsedLabel} · ${c.used_by_gym_name || \'\'}` : t.platformAdminUnusedLabel}')
  })

  it('remains gated by isPlatformAdmin, distinct from the Settings-tab Redeem-transfer-code card (isAdmin gate)', () => {
    expect(source).toContain("{adminTab === 'platforma' && isPlatformAdmin && (")
    expect(source).toContain("{adminTab === 'setari' && isAdmin && (")
  })

  it('does NOT touch the Platform gyms list card (still excluded, high-risk)', () => {
    expect(source).toContain("<div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '14px' }}>{t.platformAdminGymsTitle}</div>")
  })
})

describe('No excluded card family was touched by this batch', () => {
  it('Client and Subscription row cards remain plain divs, untouched', () => {
    expect(source).toContain('const statusColor = !activ ? \'#aaa\' : expirat ? \'#E24B4A\' : neinceput ? \'#BA7517\' : \'#0E0E0E\'')
  })

  it('WorkoutCard/MemberCard/ClassCard/PastWodCard/SectionCard are still their own components', () => {
    expect(source).toContain('function PastWodCard(')
    expect(source).toContain('export function SectionCard(')
  })

  it('exactly ten Card instances using the `<Card bordered` attribute order exist after this batch (7 from Phases 3B/3D + 3 new here; Phase 3F later added a Reports card in this same order plus a Plan row card using `<Card key={p.id} bordered` - see designSystemV1Phase3FCardMigration.test.js for the full repo-wide count - 11 in this order is expected, not a regression)', () => {
    const matches = source.match(/<Card bordered/g) || []
    expect(matches.length).toBe(11)
  })
})
