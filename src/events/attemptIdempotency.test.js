import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  newClientAttemptId, readPendingAttempt, savePendingAttempt, clearPendingAttempt, sendAttemptIdempotently,
} from './attemptIdempotency'
import { eventErrorCode } from './eventModel'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

beforeEach(() => localStorage.clear())

describe('client_attempt_id lifecycle', () => {
  it('a new draft gets a fresh v4 UUID each time', () => {
    const a = newClientAttemptId()
    const b = newClientAttemptId()
    expect(a).toMatch(UUID)
    expect(a).not.toBe(b)
  })

  it('confirmed save clears the pending draft', async () => {
    const submit = vi.fn().mockResolvedValue({ id: 'row-1' })
    const out = await sendAttemptIdempotently({ memberId: 'm', eventId: 'e', clientAttemptId: 'cid-1', fields: { result: '5' }, submit, classify: eventErrorCode })
    expect(out).toEqual({ status: 'saved', attempt: { id: 'row-1' } })
    expect(submit).toHaveBeenCalledWith('e', 'cid-1', { result: '5' })
    expect(readPendingAttempt('m', 'e')).toBeNull()
  })

  it('unknown outcome (network) keeps the draft with the SAME id; the retry reuses it', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'row-1' })
    const first = await sendAttemptIdempotently({ memberId: 'm', eventId: 'e', clientAttemptId: 'cid-1', fields: { result: '5' }, submit, classify: eventErrorCode })
    expect(first.status).toBe('unknown')
    const pending = readPendingAttempt('m', 'e')
    expect(pending).toMatchObject({ clientAttemptId: 'cid-1', fields: { result: '5' } })
    // e.g. after an app reload: the retry is driven by the stored draft
    await sendAttemptIdempotently({ memberId: 'm', eventId: 'e', clientAttemptId: pending.clientAttemptId, fields: pending.fields, submit, classify: eventErrorCode })
    expect(submit.mock.calls.map((c) => c[1])).toEqual(['cid-1', 'cid-1'])
    expect(readPendingAttempt('m', 'e')).toBeNull()
  })

  it('a definite server refusal clears the draft and rethrows', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('attempt_limit_reached'))
    await expect(sendAttemptIdempotently({ memberId: 'm', eventId: 'e', clientAttemptId: 'cid-1', fields: {}, submit, classify: eventErrorCode })).rejects.toThrow('attempt_limit_reached')
    expect(readPendingAttempt('m', 'e')).toBeNull()
  })

  it('drafts are scoped per member and event; storage failure degrades to memory', () => {
    savePendingAttempt('m1', 'e1', { clientAttemptId: 'x' })
    expect(readPendingAttempt('m2', 'e1')).toBeNull()
    expect(readPendingAttempt('m1', 'e2')).toBeNull()
    clearPendingAttempt('m1', 'e1')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    savePendingAttempt('m1', 'e1', { clientAttemptId: 'y' })
    expect(readPendingAttempt('m1', 'e1')).toMatchObject({ clientAttemptId: 'y' })
    spy.mockRestore()
    clearPendingAttempt('m1', 'e1')
  })
})
