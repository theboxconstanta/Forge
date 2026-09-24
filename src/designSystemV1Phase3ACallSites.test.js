// FORGE DESIGN SYSTEM V1.0 — PHASE 3A (call-site migration). Proves each
// approved call site actually uses the shared component (Select/EmptyState/
// StatusBadge/Input/Button), not a hardcoded inline style, and that existing
// handlers/disabled conditions/business logic are preserved verbatim at each
// site — a source-level assertion, same approach as Phase 2's nav tests,
// since App.jsx's Admin()/App() aren't practically render-testable here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'App.jsx'), 'utf-8')

describe('Select — PR variant (1 site)', () => {
  it('uses the shared Select component with the same value/onChange and all 4 options unchanged', () => {
    expect(source).toContain('<Select value={prVarianta} onChange={e => setPrVarianta(e.target.value)}')
    expect(source).toContain('<option>RX</option><option>Intermediate</option><option>Beginner</option><option>OnRamp</option>')
  })
})

describe('EmptyState — Clients + Subscriptions search (2 sites)', () => {
  it('Clients tab empty state uses the shared component with its icon and the same conditional message', () => {
    expect(source).toContain('<EmptyState icon={Users} message={clienti.length === 0 ? t.adminClientsEmptyRegistered : t.adminClientsEmptyFiltered} />')
  })

  it('Subscriptions search empty state uses the shared component with the same message, no icon', () => {
    expect(source).toContain('<EmptyState message={t.adminSubsSearchEmpty} />')
  })
})

describe('StatusBadge — Admin/Coach role badge (1 site)', () => {
  it('uses the shared component with the same conditional label', () => {
    expect(source).toContain('<StatusBadge tone="danger" label={isAdmin ? t.adminBadgeAdmin : t.adminBadgeCoach} />')
  })
})

describe('Input — Plans form, Add-Member form, Settings gym-name (7 sites)', () => {
  it('all 4 Plans-form fields use the shared component with their exact value/onChange/placeholder unchanged', () => {
    expect(source).toContain('<Input value={numePlan} onChange={e => setNumePlan(e.target.value)} placeholder={t.adminPlansNamePlaceholder}')
    expect(source).toContain('<Input type="number" value={sedintePlan} onChange={e => setSedintePlan(e.target.value)} placeholder={t.adminPlansSessionsPlaceholder}')
    expect(source).toContain('<Input type="number" value={pretPlan} onChange={e => setPretPlan(e.target.value)} placeholder={t.adminPlansPricePlaceholder}')
    expect(source).toContain('<Input type="number" min="1" value={durataPlan} onChange={e => setDurataPlan(Math.max(1, parseInt(e.target.value) || 1))} placeholder={t.adminPlansDurationPlaceholder}')
  })

  it('both Add-Member-form fields use the shared component, same handlers', () => {
    expect(source).toContain('<Input value={emailMembruNou} onChange={e => setEmailMembruNou(e.target.value)} placeholder={t.adminAddMemberEmailPlaceholder} type="email"')
    expect(source).toContain('<Input value={numeMembruNou} onChange={e => setNumeMembruNou(e.target.value)} placeholder={t.adminAddMemberNamePlaceholder}')
  })

  it('the Settings gym-name field uses the shared component, same handler', () => {
    expect(source).toContain('<Input value={gymNameInput} onChange={e => setGymNameInput(e.target.value)}')
  })
})

describe('Button primary/secondary — Settings + Platform (5 clean full-width matches found, not 9)', () => {
  it('Settings save (primary) preserves its exact onClick/disabled condition', () => {
    expect(source).toContain('<Button onClick={saveSettings} disabled={savingSettings}>')
  })

  it('gym-name save (secondary) preserves its exact onClick/disabled condition', () => {
    expect(source).toContain('<Button variant="secondary" onClick={saveGymName} disabled={savingGymName || !gymNameInput.trim() || gymNameInput.trim() === gymNameCurrent}>')
  })

  it('regenerate join code (secondary) preserves its exact onClick/disabled condition', () => {
    expect(source).toContain('<Button variant="secondary" onClick={regenerateGymJoinCode} disabled={regeneratingCode}>')
  })

  it('redeem transfer code (secondary) preserves its exact onClick/disabled condition', () => {
    expect(source).toContain('<Button variant="secondary" onClick={redeemTransferCode} disabled={redeemingCode || !redeemCodeInput.trim()}>')
  })

  it('generate signup code (secondary, Platform tab) preserves its exact onClick/disabled condition', () => {
    expect(source).toContain('<Button variant="secondary" onClick={generateSignupCode} disabled={generatingSignupCode}')
  })

  it('the 5 migrated sites no longer have their old hardcoded disabled-background ternaries', () => {
    expect(source).not.toContain("background: savingSettings ? '#e0e0e0' : '#ABE73C'")
    expect(source).not.toContain("background: (savingGymName || !gymNameInput.trim() || gymNameInput.trim() === gymNameCurrent) ? '#e0e0e0' : '#0E0E0E'")
  })
})

describe('Button destructive — delete past classes (1 site)', () => {
  it('uses the shared destructive variant, exact same onClick, business logic (stergeClaseleTrecute) untouched', () => {
    expect(source).toContain('<Button variant="destructive" fullWidth={false} onClick={stergeClaseleTrecute}>{t.adminClassDeletePast}</Button>')
  })
})

describe('Strict exclusions — confirm these were NOT touched by this phase', () => {
  it('the Abonamente member-card status rendering is untouched (regression risk #2)', () => {
    expect(source).toContain("const statusColor = !activ ? '#aaa' : expirat ? '#E24B4A' : neinceput ? '#BA7517' : '#0E0E0E'")
  })

  it('the member-search email-resolution field and its dropdown are untouched (regression risk #3)', () => {
    expect(source).toContain('const foldD = (s) => (s || \'\').normalize(\'NFD\')')
  })

  it('CreateMiscareRow permission guard is untouched', () => {
    expect(source).toContain("typeof catalog?.createMovement !== 'function'")
  })

  it('the nonstandard free-text log-save button (dark fill / lime text) was left un-migrated, not force-fit', () => {
    // still a plain <button>, not <Button> - confirms it wasn't forced into an unsuitable variant
    expect(source).toMatch(/<button onClick=\{saveFreeTextLog\}/)
  })

  it('fetchClienti\'s silent-failure behavior is unchanged - not silently fixed as part of this visual migration', () => {
    expect(source).toContain('if (!membershipsData) return')
  })
})
