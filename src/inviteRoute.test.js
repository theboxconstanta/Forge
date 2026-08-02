import { describe, it, expect } from 'vitest'
import { matchInviteRoute, matchAdminInviteRoute } from './inviteRoute'

describe('matchInviteRoute', () => {
  it('matches /invite/<id>', () => {
    expect(matchInviteRoute('/invite/abc-123')?.[1]).toBe('abc-123')
  })
  it('matches /invite/<id> with a trailing path segment ignored by the capture group', () => {
    expect(matchInviteRoute('/invite/abc-123/extra')?.[1]).toBe('abc-123')
  })
  it('does not match the root path', () => {
    expect(matchInviteRoute('/')).toBe(null)
  })
  it('does not match unrelated paths', () => {
    expect(matchInviteRoute('/settings')).toBe(null)
    expect(matchInviteRoute('/invite')).toBe(null)
    expect(matchInviteRoute('/invite/')).toBe(null)
  })
  it('does not match the M10.3 admin-invite route', () => {
    expect(matchInviteRoute('/admin-invite/abc-123')).toBe(null)
  })
})

describe('matchAdminInviteRoute', () => {
  it('matches /admin-invite/<id>', () => {
    expect(matchAdminInviteRoute('/admin-invite/abc-123')?.[1]).toBe('abc-123')
  })
  it('does not match the root path', () => {
    expect(matchAdminInviteRoute('/')).toBe(null)
  })
  it('does not match the M9 member-invite route', () => {
    expect(matchAdminInviteRoute('/invite/abc-123')).toBe(null)
  })
  it('does not match unrelated paths', () => {
    expect(matchAdminInviteRoute('/admin-invite')).toBe(null)
    expect(matchAdminInviteRoute('/admin-invite/')).toBe(null)
  })
})
