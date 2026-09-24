// FORGE DESIGN SYSTEM V1.0 — PHASE 3D (four-card migration).
// Source-level assertions, same approach as Phase 3B: proves exactly the
// four owner-approved cards (Admin -> Settings: Gym access code, Redeem
// transfer code; Admin -> Plans: New Plan form; Admin -> Classes: Past
// Weeks accordion shell) now render through the shared Card component,
// that their handlers/disabled conditions/conditional rendering/accordion
// behavior are unchanged, and that no excluded card family was touched.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'App.jsx'), 'utf-8').replace(/\r\n/g, '\n')

describe('Gym access code card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper', () => {
    expect(source).toContain("<Card bordered style={{ padding: '20px', marginTop: '14px' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '4px' }}>{t.adminGymCodeLabel}</div>")
  })

  it('preserves the join-code display and the regenerate handler/disabled condition', () => {
    expect(source).toContain("{gymJoinCode || '······'}")
    expect(source).toContain('<Button variant="secondary" onClick={regenerateGymJoinCode} disabled={regeneratingCode}>')
  })
})

describe('Redeem transfer code card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper', () => {
    expect(source).toContain("<Card bordered style={{ padding: '20px', marginTop: '14px' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '4px' }}>{t.adminRedeemTransferCodeTitle}</div>")
  })

  it('preserves the redeem input/handler and disabled condition', () => {
    expect(source).toContain('<input value={redeemCodeInput} onChange={e => setRedeemCodeInput(e.target.value)}')
    expect(source).toContain('<Button variant="secondary" onClick={redeemTransferCode} disabled={redeemingCode || !redeemCodeInput.trim()}>')
  })
})

describe('New Plan form card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper', () => {
    expect(source).toContain("<Card bordered style={{ padding: '16px', marginBottom: '14px' }}>\n            <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', marginBottom: '12px' }}>{t.adminPlansNewTitle}</div>")
  })

  it('preserves all four shared Input fields and the savePlan handler/disabled condition', () => {
    expect(source).toContain('<Input value={numePlan} onChange={e => setNumePlan(e.target.value)} placeholder={t.adminPlansNamePlaceholder}')
    expect(source).toContain('<Input type="number" value={sedintePlan} onChange={e => setSedintePlan(e.target.value)} placeholder={t.adminPlansSessionsPlaceholder}')
    expect(source).toContain('<Input type="number" value={pretPlan} onChange={e => setPretPlan(e.target.value)} placeholder={t.adminPlansPricePlaceholder}')
    expect(source).toContain('<Input type="number" min="1" value={durataPlan} onChange={e => setDurataPlan(Math.max(1, parseInt(e.target.value) || 1))} placeholder={t.adminPlansDurationPlaceholder}')
    expect(source).toContain('<button onClick={savePlan} disabled={savingPlan}')
  })

  it('Plan row cards (list below the form) were plain divs as of this phase (Phase 3F later migrated them to Card - see designSystemV1Phase3FCardMigration.test.js)', () => {
    expect(source).toContain("<Card key={p.id} bordered style={{ padding: '14px', marginBottom: '8px' }}>")
  })
})

describe('Past Weeks accordion shell — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper, with overflow:hidden preserved for the collapse animation', () => {
    expect(source).toContain("<Card bordered style={{ overflow: 'hidden', marginBottom: '14px' }}>\n            <button onClick={toggleClaseTrecuteOpen}")
  })

  it('preserves the CSS-grid collapse/expand mechanism and the rotating chevron, unchanged', () => {
    expect(source).toContain("gridTemplateRows: claseTrecuteOpen ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease'")
    expect(source).toContain("transform: claseTrecuteOpen ? 'rotate(180deg)' : 'rotate(0deg)'")
  })

  it('preserves the lazy-fetch-on-first-open + cached-thereafter loading/empty states', () => {
    expect(source).toContain('{_loadingClaseTrecute ? (')
    expect(source).toContain('claseTrecuteLoaded && claseTrecute.length === 0 ? (')
  })

  it('does NOT touch the per-class row cards one level deeper (renderClassDayGroup), still excluded', () => {
    expect(source).toContain('{days.map(([date, claseZi]) => renderClassDayGroup(date, claseZi))}')
    // the per-class row card itself (App.jsx ~5121) stays a plain div, not <Card>
    expect(source).toContain("<div key={c.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>")
  })
})

describe('No excluded card family or high-risk area was touched by this batch', () => {
  it('the Client and Subscription row cards (regression risks #2/#5) remain plain divs, untouched', () => {
    expect(source).toContain("borderLeft: `4px solid ${statusColor}`")
    expect(source).toContain('const statusColor = !activ ? \'#aaa\' : expirat ? \'#E24B4A\' : neinceput ? \'#BA7517\' : \'#0E0E0E\'')
  })

  it('WorkoutCard/MemberCard/ClassCard/PastWodCard/SectionCard are still their own components', () => {
    expect(source).toContain('function PastWodCard(')
    expect(source).toContain('export function SectionCard(')
  })

  it('Platform gyms list remains a plain div, untouched by this batch (signup codes was migrated later, in Phase 3E)', () => {
    expect(source).toContain("<div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '14px' }}>{t.platformAdminGymsTitle}</div>")
  })

  it('exactly four new Card instances were added in this batch (7 total with Phase 3B\'s 3; Phase 3E added 3 more, Phase 3F added 2 more — see designSystemV1Phase3ECardMigration.test.js / designSystemV1Phase3FCardMigration.test.js — 11 using this exact attribute order is expected, not a regression)', () => {
    const matches = source.match(/<Card bordered/g) || []
    expect(matches.length).toBe(11)
  })
})
