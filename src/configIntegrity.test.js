import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Deployment-integrity regression check for the 2026-07-29 P0: a copy/paste
// error in supabase/config.toml gave [functions.invitation-final-commit] an
// explicit entrypoint/import_map belonging to send-notification. `supabase
// functions deploy <slug>` trusts that config verbatim - it silently
// deployed send-notification's code under the invitation-final-commit
// production URL, with no error at deploy time (only discovered live, via
// the wrong function's own auth check rejecting every call).
//
// Not a full TOML parser - config.toml's [functions.*] blocks only ever use
// simple `key = "value"` lines, so a line-scanner is enough and avoids a new
// dependency for a narrowly-scoped structural check. Generic: catches this
// defect class for ANY current or future function block, not just this one.
export function findMismatchedFunctionConfigs(configToml) {
  const mismatches = []
  let currentSlug = null
  for (const rawLine of configToml.split('\n')) {
    const line = rawLine.trim()
    const sectionMatch = line.match(/^\[functions\.([a-zA-Z0-9_-]+)\]$/)
    if (sectionMatch) { currentSlug = sectionMatch[1]; continue }
    if (!currentSlug) continue
    if (/^\[/.test(line)) { currentSlug = null; continue } // left the section
    const pathMatch = line.match(/^(entrypoint|import_map)\s*=\s*"([^"]+)"/)
    if (!pathMatch) continue
    const [, key, value] = pathMatch
    if (!value.includes(`/functions/${currentSlug}/`)) {
      mismatches.push({ slug: currentSlug, key, value })
    }
  }
  return mismatches
}

describe('supabase/config.toml - function entrypoint/import_map self-reference', () => {
  const configPath = path.resolve(__dirname, '../supabase/config.toml')
  const configToml = fs.readFileSync(configPath, 'utf8')

  it('detects the exact 2026-07-29 defect shape (regression fixture, not live config)', () => {
    const broken = `
[functions.invitation-final-commit]
enabled = true
verify_jwt = false
import_map = "./functions/send-notification/deno.json"
entrypoint = "./functions/send-notification/index.ts"
`
    expect(findMismatchedFunctionConfigs(broken)).toEqual([
      { slug: 'invitation-final-commit', key: 'import_map', value: './functions/send-notification/deno.json' },
      { slug: 'invitation-final-commit', key: 'entrypoint', value: './functions/send-notification/index.ts' },
    ])
  })

  it('does not flag a function whose explicit paths correctly self-reference', () => {
    const ok = `
[functions.check-subscriptions]
enabled = true
verify_jwt = false
import_map = "./functions/check-subscriptions/deno.json"
entrypoint = "./functions/check-subscriptions/index.ts"
`
    expect(findMismatchedFunctionConfigs(ok)).toEqual([])
  })

  it('every [functions.*] block in the real config.toml self-references its own slug', () => {
    expect(findMismatchedFunctionConfigs(configToml)).toEqual([])
  })
})
