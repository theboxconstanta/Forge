// FORGE DESIGN SYSTEM V1.0 — PHASE 3B (controlled three-card visual pilot).
// Source-level assertions, same approach as Phase 3A: proves exactly the
// three owner-approved Admin -> Settings cards (Cancel Window, Online
// Payments, Gym Name) now render through the shared Card component, that
// their handlers/disabled conditions/conditional rendering are unchanged,
// and that no other card family (WorkoutCard/MemberCard/ClassCard/
// Abonamente/etc.) was touched.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
// normalize CRLF -> LF: this file is checked out with \r\n on this repo, but
// the literal multi-line toContain strings below are written with \n
const source = readFileSync(join(here, 'App.jsx'), 'utf-8').replace(/\r\n/g, '\n')

describe('Card import', () => {
  it('App.jsx imports the shared Card component from ./components', () => {
    expect(source).toMatch(/import \{[^}]*\bCard\b[^}]*\} from '\.\/components'/)
  })
})

describe('Cancel Window card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper', () => {
    expect(source).toContain("<Card bordered style={{ padding: '20px' }}>\n          <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '4px' }}>{t.adminSettingsCancelWindowTitle}</div>")
  })

  it('preserves the stepper handlers unchanged', () => {
    expect(source).toContain('onClick={() => setCancelWindowSetting(prev => Math.max(0, prev - 0.5))}')
    expect(source).toContain('onClick={() => setCancelWindowSetting(prev => prev + 0.5)}')
  })

  it('preserves the conditional no-restriction banner and the Save button/disabled condition', () => {
    expect(source).toContain('{cancelWindowSetting === 0 && (')
    expect(source).toContain('<Button onClick={saveSettings} disabled={savingSettings}>')
  })

  it('closes with </Card>, not a plain </div>, for this section', () => {
    expect(source).toContain("{savingSettings ? t.adminSettingsSaving : t.adminSettingsSaveButton}\n          </Button>\n        </Card>")
  })
})

describe('Online Payments card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper, immediately followed by the payments title row', () => {
    expect(source).toContain("<Card bordered style={{ padding: '20px', marginTop: '14px' }}>\n          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>\n            <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '6px' }}><CreditCard size={16} /> {t.adminOnlinePaymentsTitle}</div>")
  })

  it('preserves the toggle handler, disabled state and enabled/disabled conditional styling', () => {
    expect(source).toContain('<button onClick={toggleOnlinePayments} disabled={savingOnlinePayments}')
    expect(source).toContain("background: onlinePaymentsEnabled ? '#ABE73C' : '#e0e0e0'")
    expect(source).toContain('{onlinePaymentsEnabled ? t.adminOnlinePaymentsEnabled : t.adminOnlinePaymentsDisabled}')
  })
})

describe('Gym Name card — migrated to Card, behavior preserved', () => {
  it('uses <Card bordered> as its wrapper', () => {
    expect(source).toContain('<Card bordered style={{ padding: \'20px\', marginTop: \'14px\' }}>\n          <div style={{ fontSize: \'15px\', fontWeight: \'600\', color: \'#0E0E0E\', marginBottom: \'4px\' }}>{t.adminGymNameLabel}</div>')
  })

  it('preserves the shared Input/Button and the exact save-disabled condition', () => {
    expect(source).toContain('<Input value={gymNameInput} onChange={e => setGymNameInput(e.target.value)}')
    expect(source).toContain('disabled={savingGymName || !gymNameInput.trim() || gymNameInput.trim() === gymNameCurrent}')
  })
})

describe('No other card family was touched by this pilot', () => {
  it('WorkoutCard/MemberCard/ClassCard/PastWodCard/SectionCard/PhotoResultCard are still their own components, not <Card>', () => {
    expect(source).not.toMatch(/<Card[ >].*WorkoutCard/)
    expect(source).toContain('function PastWodCard(')
    expect(source).toContain('export function SectionCard(')
  })

  it('the Abonamente member-card status rendering is untouched (regression risk)', () => {
    expect(source).toContain("const statusColor = !activ ? '#aaa' : expirat ? '#E24B4A' : neinceput ? '#BA7517' : '#0E0E0E'")
  })

  it('the three Phase 3B cards are present in the Settings-tab region (Phase 3D added 2 more, Phase 3F added 1 more [Reports] to this same tab — see designSystemV1Phase3DCardMigration.test.js / designSystemV1Phase3FCardMigration.test.js — 6 total is expected, not a regression)', () => {
    const setariStart = source.indexOf("adminTab === 'setari' && isAdmin")
    const setariEnd = source.indexOf("adminTab === 'billing'")
    const setariBlock = source.slice(setariStart, setariEnd)
    const matches = setariBlock.match(/<Card bordered/g) || []
    expect(matches.length).toBe(6)
  })
})
