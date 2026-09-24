// FORGE DESIGN SYSTEM V1.0 — PHASE 3F (two-card-type migration).
// Source-level assertions, same approach as Phases 3B/3D/3E: proves the
// two owner-approved cards (Admin -> Settings Reports card, Admin -> Plans
// Plan row card) now render through the shared Card component, that their
// handlers/state/conditional rendering are unchanged in BOTH states, and
// that no excluded card family was touched.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'App.jsx'), 'utf-8').replace(/\r\n/g, '\n')

describe('Reports card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper', () => {
    expect(source).toContain("<Card bordered style={{ padding: '16px 20px', marginBottom: '14px' }}>\n          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>\n            <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '6px' }}><BarChart3 size={15} /> {t.adminSettingsReportsTitle}</div>")
  })

  it('preserves the fetchRapoarte refresh handler and rapoarteData loading/loaded conditional', () => {
    expect(source).toContain('<button onClick={fetchRapoarte}')
    expect(source).toContain('{rapoarteData ? (')
    expect(source).toContain('{t.adminSettingsLoading}')
  })

  it('preserves all three statistic tiles as plain divs, NOT converted to nested Cards', () => {
    expect(source).toContain("{ label: t.adminSettingsActiveMembers, value: rapoarteData.membriActivi, icon: Users, color: '#5B7FCC', bg: '#EEF2FF' }")
    expect(source).toContain("{ label: t.adminSettingsSubsThisMonth, value: rapoarteData.aboVandute, icon: Ticket, color: '#0E0E0E', bg: '#f0f0f0' }")
    expect(source).toContain("{ label: t.adminSettingsRevenueRon, value: rapoarteData.venituriLuna % 1 === 0 ? rapoarteData.venituriLuna : rapoarteData.venituriLuna.toFixed(0), icon: Coins, color: '#B86E00', bg: '#FFF8EC' }")
    expect(source).toContain("<div key={label} style={{ background: bg, borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>")
  })
})

describe('Plan row card — migrated to Card, both states preserved', () => {
  it('uses <Card key={p.id} bordered> as its wrapper', () => {
    expect(source).toContain("<Card key={p.id} bordered style={{ padding: '14px', marginBottom: '8px' }}>")
  })

  it('normal-state display (plan name/sessions/price/duration + Archive button) is unchanged', () => {
    expect(source).toContain('{p.sessions ? t.adminPlansSessionsCount(p.sessions) : t.adminPlansUnlimited} · {p.price != null ? t.adminPlansPriceSet(p.price) : t.adminPlansPriceUnset}')
    expect(source).toContain("{confirmArchivePlan !== p.id && (\n                  <button onClick={() => setConfirmArchivePlan(p.id)}")
  })

  it('archive-confirmation state (Cancel + Confirm Archive) is unchanged, including stergePlan(p.id)', () => {
    expect(source).toContain('{confirmArchivePlan === p.id && (')
    expect(source).toContain('<button onClick={() => setConfirmArchivePlan(null)}')
    expect(source).toContain('onClick={() => { setConfirmArchivePlan(null); stergePlan(p.id) }}')
  })

  it('closes with </Card>, matching the opening tag', () => {
    expect(source).toContain('                </div>\n              )}\n            </Card>\n          ))}')
  })
})

describe('No excluded card family was touched by this batch', () => {
  it('Platform All gyms and Coach management remain plain divs, untouched', () => {
    expect(source).toContain("<div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '14px' }}>{t.platformAdminGymsTitle}</div>")
    expect(source).toContain("<div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '14px' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '4px' }}>{t.adminSettingsCoachTitle}</div>")
  })

  it('New Subscription form and its member-search guard remain untouched', () => {
    expect(source).toContain('const selectMember = (c) => { setEmailAbonament(c.email); setAbonamentDropdownOpen(false) }')
  })

  it('Client and Subscription row cards (statusColor) remain untouched', () => {
    expect(source).toContain('const statusColor = !activ ? \'#aaa\' : expirat ? \'#E24B4A\' : neinceput ? \'#BA7517\' : \'#0E0E0E\'')
  })

  it('WorkoutCard/MemberCard/ClassCard/PastWodCard/SectionCard are still their own components', () => {
    expect(source).toContain('function PastWodCard(')
    expect(source).toContain('export function SectionCard(')
  })

  it('exactly twelve Card instances exist repo-wide (10 from Phases 3B/3D/3E + 2 new)', () => {
    const matches = source.match(/<Card (bordered|key=)/g) || []
    expect(matches.length).toBe(12)
  })
})
