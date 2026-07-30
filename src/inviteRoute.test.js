import { describe, it, expect } from 'vitest'
import { matchInviteRoute } from './inviteRoute'

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
})
