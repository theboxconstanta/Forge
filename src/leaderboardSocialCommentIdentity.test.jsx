// FORGE — LEADERBOARD SOCIAL V1, COMMENT AUTHOR IDENTITY BUG (owner live
// report, confirmed via a real production row: wod_log_comments.id
// c7994f6a-1c0c-4524-8cd6-d576a6a63f6b, member_id 97a4e88a... whose
// profiles row has full_name "Lucian Rosca" + a real avatar_url — the DATA
// was always correct; the bug was client-side only).
//
// ROOT CAUSE: `identities` (leaderboardSocialUI.jsx) is populated once, in
// loadPanel(), from whatever reactor/comment author ids existed AT THAT
// MOMENT. postComment() optimistically appended the new comment locally
// but never added the poster's own id to `identities` — so a comment
// posted by someone not already a reactor/prior commenter on that result
// (most commonly the very first interaction) rendered nameOf() undefined
// -> "Anonymous", and AvatarCircle's initials fallback on that string ->
// "A" (getInitiale('Anonymous') = 'A'). Ownership (Edit/Delete) was
// unaffected because commentControlsFor compares member_id === user.id
// directly, never touching `identities` — which is exactly why the bug
// looked contradictory (controls right, name wrong).
//
// Feed never hits this: it has no optimistic local append at all — its
// Realtime subscription fully refetches (and re-resolves every author's
// identity from scratch) on every insert. This component deliberately has
// no Realtime (V1 scope), so the fix merges the poster's own identity in
// directly via the SAME canonical resolveMemberIdentity path.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

function chainableReadWrite(selectResult, insertResult) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    order: () => selectResult,
    insert: () => obj,
    single: () => insertResult,
  }
  return obj
}
function chainableLookup(result) {
  const obj = { select: () => obj, in: () => result }
  return obj
}

let commentsTable
let profilesTable
let membersTable
const fromMock = vi.fn((table) => {
  if (table === 'wod_log_comments') return commentsTable
  if (table === 'profiles') return profilesTable
  if (table === 'members') return membersTable
  throw new Error(`unexpected table: ${table}`)
})
vi.mock('./supabase.js', () => ({ supabase: { from: (...args) => fromMock(...args) } }))

import LeaderboardSocialSummary from './leaderboardSocialUI'
import { getT } from './translations.js'

const t = getT('en')

afterEach(() => {
  cleanup()
  fromMock.mockClear()
})

function baseProps(overrides = {}) {
  return {
    logId: 'log-1',
    summary: { counts: {}, mine: null },
    reactorRows: [],
    commentCount: 0,
    onReactionTap: vi.fn(),
    onCommentCountChange: vi.fn(),
    user: { id: 'user-1' },
    gymId: 'gym-1',
    isCoachOrAdmin: false,
    showToast: vi.fn(),
    t,
    ...overrides,
  }
}

async function openPanel() {
  fireEvent.click(screen.getByText('💬'))
  await waitFor(() => expect(fromMock).toHaveBeenCalled())
}

describe('comment author identity — the reported bug, fixed', () => {
  it("the poster's OWN comment shows their real name/avatar immediately, not Anonymous/initials-only", async () => {
    commentsTable = chainableReadWrite(
      { data: [], error: null }, // loadPanel: no prior comments on this result
      { data: { id: 'c1', wod_log_id: 'log-1', member_id: 'user-1', text: 'nice work', created_at: '2026-09-21T08:00:00Z', edited_at: null }, error: null },
    )
    profilesTable = chainableLookup({ data: [{ id: 'user-1', full_name: 'Lucian Rosca', email: 'lucian@example.com', avatar_url: 'https://cdn.example/lucian.jpg' }], error: null })
    membersTable = chainableLookup({ data: [], error: null })

    render(<LeaderboardSocialSummary {...baseProps()} />)
    await openPanel()

    const textarea = screen.getByPlaceholderText('Write a comment...')
    fireEvent.change(textarea, { target: { value: 'nice work' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => expect(screen.getByText('Lucian Rosca')).toBeInTheDocument())
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument()
    const avatar = screen.getByAltText('Lucian Rosca')
    expect(avatar).toHaveAttribute('src', 'https://cdn.example/lucian.jpg')
  })

  it("a member without an avatar_url shows their real initials, never generic 'A'/Anonymous initials", async () => {
    commentsTable = chainableReadWrite(
      { data: [], error: null },
      { data: { id: 'c2', wod_log_id: 'log-1', member_id: 'user-1', text: 'solid', created_at: '2026-09-21T08:00:00Z', edited_at: null }, error: null },
    )
    profilesTable = chainableLookup({ data: [{ id: 'user-1', full_name: 'Maria Popescu', email: 'maria@example.com', avatar_url: null }], error: null })
    membersTable = chainableLookup({ data: [], error: null })

    render(<LeaderboardSocialSummary {...baseProps()} />)
    await openPanel()
    fireEvent.change(screen.getByPlaceholderText('Write a comment...'), { target: { value: 'solid' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => expect(screen.getByText('Maria Popescu')).toBeInTheDocument())
    expect(screen.getByText('MP')).toBeInTheDocument() // getInitiale('Maria Popescu')
    expect(screen.queryByText('A')).not.toBeInTheDocument() // getInitiale('Anonymous')
  })

  it("ANOTHER member's pre-existing comment (loaded, not posted locally) already resolved correctly — no regression", async () => {
    commentsTable = chainableReadWrite(
      { data: [{ id: 'c3', wod_log_id: 'log-1', member_id: 'other-member', text: 'crushed it', created_at: '2026-09-21T08:00:00Z', edited_at: null }], error: null },
      { data: null, error: null },
    )
    profilesTable = chainableLookup({ data: [{ id: 'other-member', full_name: 'Vali Rosca', email: 'vali@example.com', avatar_url: null }], error: null })
    membersTable = chainableLookup({ data: [], error: null })

    render(<LeaderboardSocialSummary {...baseProps()} />)
    await openPanel()

    await waitFor(() => expect(screen.getByText('Vali Rosca')).toBeInTheDocument())
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument()
  })

  it('editing a just-posted comment preserves the resolved author identity', async () => {
    commentsTable = chainableReadWrite(
      { data: [], error: null },
      { data: { id: 'c4', wod_log_id: 'log-1', member_id: 'user-1', text: 'first draft', created_at: '2026-09-21T08:00:00Z', edited_at: null }, error: null },
    )
    profilesTable = chainableLookup({ data: [{ id: 'user-1', full_name: 'Lucian Rosca', email: 'lucian@example.com', avatar_url: null }], error: null })
    membersTable = chainableLookup({ data: [], error: null })

    render(<LeaderboardSocialSummary {...baseProps()} />)
    await openPanel()
    fireEvent.change(screen.getByPlaceholderText('Write a comment...'), { target: { value: 'first draft' } })
    fireEvent.click(screen.getByText('Send'))
    await waitFor(() => expect(screen.getByText('Lucian Rosca')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByText('Lucian Rosca')).toBeInTheDocument()
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument()
  })
})
