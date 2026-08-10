import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase.js'

vi.mock('./supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

const { fetchMovementsForGym, createMovement, DuplicateMovementError } = await import('./movementsApi.js')

const state = {
  selectResult: { data: [], error: null },
  insertResult: { data: null, error: null },
  lastOrFilter: null,
  lastInsertPayload: null,
}

function makeQueryBuilder() {
  return {
    select: () => ({
      or: (filter) => {
        state.lastOrFilter = filter
        return { order: async () => state.selectResult }
      },
    }),
    insert: (payload) => {
      state.lastInsertPayload = payload
      return { select: () => ({ single: async () => state.insertResult }) }
    },
  }
}

beforeEach(() => {
  state.selectResult = { data: [], error: null }
  state.insertResult = { data: null, error: null }
  state.lastOrFilter = null
  state.lastInsertPayload = null
  supabase.from.mockReset().mockImplementation(() => makeQueryBuilder())
})

describe('fetchMovementsForGym', () => {
  it('queries movements scoped to the given gym plus the platform-global tier', async () => {
    state.selectResult = { data: [{ id: 'm-1', gym_id: 'gym-1', name: 'DB Snatch' }], error: null }
    const rows = await fetchMovementsForGym('gym-1')
    expect(state.lastOrFilter).toBe('gym_id.eq.gym-1,gym_id.is.null')
    expect(rows).toHaveLength(1)
  })

  it('throws on a query error', async () => {
    state.selectResult = { data: null, error: { message: 'network down' } }
    await expect(fetchMovementsForGym('gym-1')).rejects.toBeTruthy()
  })
})

describe('createMovement', () => {
  it('inserts a trimmed name scoped to the gym', async () => {
    state.insertResult = { data: { id: 'm-2', gym_id: 'gym-1', name: 'DB Snatch' }, error: null }
    const row = await createMovement('gym-1', { name: '  DB Snatch  ' })
    expect(state.lastInsertPayload).toMatchObject({ gym_id: 'gym-1', name: 'DB Snatch', aliases: [] })
    expect(row.id).toBe('m-2')
  })

  it('surfaces a unique-violation (Postgres 23505) as a friendly DuplicateMovementError, not a raw error', async () => {
    state.insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    await expect(createMovement('gym-1', { name: 'DB Snatch' })).rejects.toThrow(DuplicateMovementError)
  })

  it('rejects with a plain Error for any other failure', async () => {
    state.insertResult = { data: null, error: { code: '42501', message: 'permission denied' } }
    const err = await createMovement('gym-1', { name: 'DB Snatch' }).catch((e) => e)
    expect(err).not.toBeInstanceOf(DuplicateMovementError)
    expect(err.message).toBe('permission denied')
  })
})
