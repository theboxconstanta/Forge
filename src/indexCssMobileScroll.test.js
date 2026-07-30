import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// M9 Mobile Onboarding Scroll fix (2026-07-30) regression check. jsdom
// doesn't evaluate real CSS media queries/cascade, so this can't be a
// rendered-layout test - it verifies the STYLESHEET'S OWN TEXT still
// carries the .invite-onboarding override inside every touch-device media
// query that fixes #root to the viewport with overflow:hidden. Without it,
// InviteOnboarding.jsx (which has no internal scroll region of its own,
// unlike App.jsx's .app-frame) would silently regress to having its
// content hard-clipped with no scroll mechanism on any portrait/landscape
// touch device again - exactly the production P0 this fix closed.
// Normalize CRLF - this repo's working-tree line endings vary by checkout.
const css = fs.readFileSync(path.resolve(__dirname, './index.css'), 'utf8').replace(/\r\n/g, '\n')

// Every @media block gated on (hover: none) and (pointer: coarse) - i.e.
// every touch-device-specific block, portrait or landscape.
const touchMediaBlocks = [...css.matchAll(/@media[^{]*\(hover:\s*none\)[^{]*\{([\s\S]*?)\n\}\n/g)].map((m) => m[1])

describe('index.css - mobile onboarding scroll contract', () => {
  it('found at least one touch-device (hover:none, pointer:coarse) media block to check', () => {
    expect(touchMediaBlocks.length).toBeGreaterThan(0)
  })

  it('every touch-device media block that fixes #root to the viewport also carries an .invite-onboarding override', () => {
    const blocksThatFixRoot = touchMediaBlocks.filter((block) => /#root\s*\{[^}]*position:\s*fixed/.test(block))
    expect(blocksThatFixRoot.length).toBeGreaterThan(0) // sanity: the thing being guarded against still exists
    for (const block of blocksThatFixRoot) {
      expect(block).toContain('.invite-onboarding')
    }
  })

  it('the .invite-onboarding #root override restores normal document flow (not fixed, not overflow:hidden)', () => {
    const overrideRules = [...css.matchAll(/\.invite-onboarding\s+#root\s*\{([^}]*)\}/g)].map((m) => m[1])
    expect(overrideRules.length).toBeGreaterThan(0)
    for (const rule of overrideRules) {
      expect(rule).not.toMatch(/position:\s*fixed/)
      expect(rule).not.toMatch(/overflow:\s*hidden/)
    }
  })

  it('body keeps its own scrollability for .invite-onboarding (every body{overflow:hidden} rule in a touch media block is scoped away from it)', () => {
    for (const block of touchMediaBlocks) {
      const bodyHiddenRules = [...block.matchAll(/\bbody[^{,]*\{[^}]*overflow:\s*hidden[^}]*\}/g)].map((m) => m[0])
      for (const rule of bodyHiddenRules) {
        expect(rule).toContain('.invite-onboarding')
      }
    }
  })
})
