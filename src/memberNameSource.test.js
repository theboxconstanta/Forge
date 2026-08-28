import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// INC-01 regression check: "some members show 'Member'/'Membru' instead of
// their real name" traced to 6 call sites across Feed/Community/class-
// roster/leaderboard/Admin-clients-list all reading full_name/email/
// avatar_url from `members` instead of `profiles`. `members.full_name` was
// silently stale for 8 real production members (member_field_drift,
// unreconciled - see member_domain_consistency_report) while
// profiles.full_name had the real, correct value - `members` is the P0-02
// canonical source for `gender` specifically, never for display identity
// fields, which live in `profiles` (confirmed by forge-admin-web's own
// Attendance Domain Assessment: `members` is "a one-way, edit-blind mirror").
//
// Not a full JS parser - same philosophy as configIntegrity.test.js's
// line/window scanner: a query batch-looking-up OTHER members' identity
// (`.in('id', ...)`) that also selects full_name from `members` is exactly
// the historically-buggy shape; a query scoped to the CURRENT user's own
// row (`.eq('id', user.id)`) reading full_name from `members` is always
// safe (self-reads are never stale relative to another member's mirror)
// and must not be flagged.
export function findBatchFullNameReadsFromMembers(source) {
  const violations = []
  const callRe = /\.from\(\s*['"]members['"]\s*\)\s*\.select\(\s*['"]([^'"]*)['"]\s*\)/g
  let match
  while ((match = callRe.exec(source)) !== null) {
    const selectArgs = match[1]
    if (!/\bfull_name\b/.test(selectArgs)) continue
    const windowEnd = match.index + match[0].length + 200
    const tail = source.slice(match.index + match[0].length, windowEnd)
    const isBatchLookup = /\.in\(\s*['"]id['"]/.test(tail)
    const isSelfScoped = /\.eq\(\s*['"]id['"]\s*,\s*user\.id\s*\)/.test(tail)
    if (isBatchLookup && !isSelfScoped) {
      const lineNumber = source.slice(0, match.index).split('\n').length
      violations.push({ line: lineNumber, selectArgs })
    }
  }
  return violations
}

describe('App.jsx - INC-01 regression: full_name must never be batch-read from `members`', () => {
  const appJsxPath = path.resolve(__dirname, './App.jsx')

  it('has zero batch (.in) full_name reads from `members` - display identity must come from `profiles`', () => {
    const source = fs.readFileSync(appJsxPath, 'utf8')
    const violations = findBatchFullNameReadsFromMembers(source)
    expect(violations).toEqual([])
  })

  it('scanner itself correctly flags the exact historically-buggy shape (sanity check on the scanner)', () => {
    const buggyExample = `
      const { data: profiles } = await supabase.from('members').select('id, full_name, avatar_url').in('id', allIds)
    `
    expect(findBatchFullNameReadsFromMembers(buggyExample)).toEqual([{ line: 2, selectArgs: 'id, full_name, avatar_url' }])
  })

  it('scanner does not flag a legitimate self-scoped read (.eq id user.id)', () => {
    const safeExample = `
      const { data: existing } = await supabase.from('members').select('id, full_name').eq('id', user.id).maybeSingle()
    `
    expect(findBatchFullNameReadsFromMembers(safeExample)).toEqual([])
  })

  it('scanner does not flag a members query that does not select full_name at all (e.g. gender-only overlay)', () => {
    const genderOnlyExample = `
      supabase.from('members').select('id, gender').in('id', ids)
    `
    expect(findBatchFullNameReadsFromMembers(genderOnlyExample)).toEqual([])
  })
})
