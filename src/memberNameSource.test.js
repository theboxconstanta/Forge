import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// MEMBER IDENTITY READ ALIGNMENT ("No name" incident) - supersedes the
// original INC-01 scanner.
//
// INC-01 (2026-08-28) switched 6 member display-identity read sites from
// `members` to `profiles` because members.full_name was then stale for 8 old
// members. That was a HALF fix: it broke every member created after
// 2026-07-27, whose name self-signup / onboarding writes ONLY to `members`
// (11 real production members showed "No name" in the Admin roster).
//
// Owner decision (final): `public.members` is the CANONICAL identity Source of
// Truth; `public.profiles` identity is LEGACY FALLBACK ONLY. Precedence
// everywhere member identity is displayed:
//
//     members.<field>  ->  profiles.<field>  ->  existing final fallback
//
// centralised in the ONE pure resolver resolveMemberIdentity(member, profile)
// (src/utils.js). This scanner guards BOTH failure modes at the source level:
//   (A) a batch identity lookup of `profiles` that is NOT paired with a
//       sibling `members` lookup -> stale/empty profiles would hide a valid
//       members identity (the regression this incident fixed).
//   (B) resolveMemberIdentity must be the mechanism (imported + used), so the
//       legacy `profiles` value still displays when `members` identity is
//       absent (the case INC-01 was originally about).
//
// Not a full JS parser - same window-scanner philosophy as
// configIntegrity.test.js: a batch lookup (`.in('id', ...)`) selecting
// full_name is a DISPLAY-IDENTITY read; a self-scoped read (`.eq('id',
// user.id)`) is always safe (a member's own row is never stale) and is
// ignored.

const IDENTITY_SELECT_RE =
  /\.from\(\s*['"](members|profiles)['"]\s*\)\s*\.select\(\s*['"]([^'"]*)['"]\s*\)\s*\.in\(\s*['"]id['"]/g

function scanIdentityReads(source) {
  const hits = []
  let match
  while ((match = IDENTITY_SELECT_RE.exec(source)) !== null) {
    const [, table, selectArgs] = match
    if (!/\bfull_name\b/.test(selectArgs)) continue
    const line = source.slice(0, match.index).split('\n').length
    // is this read self-scoped (own row) rather than a batch of OTHER members?
    const tail = source.slice(match.index, match.index + match[0].length + 60)
    const isSelfScoped = /\.eq\(\s*['"]id['"]\s*,\s*user\.id\s*\)/.test(tail)
    hits.push({ table, selectArgs, line, isSelfScoped })
  }
  return hits
}

// A `profiles` identity read is aligned when a `members` identity read sits
// within a reasonable window either side of it (same fetch function).
function profilesReadsWithoutMembersSibling(source) {
  const hits = scanIdentityReads(source).filter((h) => !h.isSelfScoped)
  const membersLines = hits.filter((h) => h.table === 'members').map((h) => h.line)
  return hits
    .filter((h) => h.table === 'profiles')
    .filter((h) => !membersLines.some((ml) => Math.abs(ml - h.line) <= 40))
}

describe('App.jsx - MEMBER IDENTITY READ ALIGNMENT: every batch display-identity read is members-first', () => {
  const appJsxPath = path.resolve(__dirname, './App.jsx')
  const source = () => fs.readFileSync(appJsxPath, 'utf8')

  it('no batch `profiles` full_name lookup is left without a sibling `members` full_name lookup', () => {
    expect(profilesReadsWithoutMembersSibling(source())).toEqual([])
  })

  it('the ONE shared resolver is imported and used for identity merges', () => {
    const s = source()
    expect(s).toMatch(/import \{[^}]*\bresolveMemberIdentity\b[^}]*\} from '\.\/utils'/)
    // used at least once per aligned surface (feed authors, feed comments,
    // community strip, fetchClienti, fetchRezervariClasa, fetchRezervariZi,
    // fetchClasament)
    expect((s.match(/resolveMemberIdentity\(/g) || []).length).toBeGreaterThanOrEqual(7)
  })

  it('gender is still read from `members` (canonical since P0-02), never from profiles', () => {
    const s = source()
    expect(s).toMatch(/\.from\('members'\)\s*\n?\s*\.select\([^)]*gender[^)]*\)/)
    // no profiles select pulls gender
    const profilesGender = s.match(/\.from\('profiles'\)\.select\('[^']*gender[^']*'\)/g) || []
    expect(profilesGender).toEqual([])
  })

  it('scanner sanity: flags a lone batch profiles identity read', () => {
    const lone = `
      const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids)
    `
    expect(profilesReadsWithoutMembersSibling(lone).length).toBe(1)
  })

  it('scanner sanity: a paired members+profiles read is NOT flagged', () => {
    const paired = `
      const [{ data: p }, { data: m }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids),
        supabase.from('members').select('id, full_name, avatar_url').in('id', ids),
      ])
      ids.forEach(id => { map[id] = resolveMemberIdentity(mById[id], pById[id]) })
    `
    expect(profilesReadsWithoutMembersSibling(paired)).toEqual([])
  })

  it('scanner sanity: a self-scoped members full_name read (own row) is never flagged', () => {
    const selfRead = `
      const { data: existing } = await supabase.from('members').select('id, full_name').eq('id', user.id).maybeSingle()
    `
    expect(scanIdentityReads(selfRead).every((h) => h.isSelfScoped)).toBe(true)
  })
})
