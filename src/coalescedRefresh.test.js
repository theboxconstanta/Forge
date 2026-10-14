import { describe, it, expect, vi } from 'vitest'
import { coalescedRefresh } from './coalescedRefresh'

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const flush = () => new Promise(r => setTimeout(r, 0))

describe('coalescedRefresh', () => {
  it('runs immediately on the first event (no added delay)', () => {
    const run = vi.fn(() => Promise.resolve())
    coalescedRefresh(run)()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a burst of 40 row events during a fetch costs exactly 2 fetches', async () => {
    const pending = []
    const run = vi.fn(() => { const d = deferred(); pending.push(d); return d.promise })
    const trigger = coalescedRefresh(run)
    for (let i = 0; i < 40; i++) trigger()
    expect(run).toHaveBeenCalledTimes(1)
    pending[0].resolve(); await flush()
    expect(run).toHaveBeenCalledTimes(2) // trailing fetch, started after the last event
    pending[1].resolve(); await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never runs two fetches at once (no out-of-order responses)', async () => {
    let active = 0, maxActive = 0
    const pending = []
    const run = () => { active++; maxActive = Math.max(maxActive, active); const d = deferred(); pending.push(d); return d.promise.then(() => { active-- }) }
    const trigger = coalescedRefresh(run)
    trigger(); trigger()
    pending[0].resolve(); await flush()
    trigger()
    pending[1].resolve(); await flush()
    pending[2].resolve(); await flush()
    expect(maxActive).toBe(1)
  })

  it('an event arriving during the trailing fetch triggers one more (final state is never stale)', async () => {
    const pending = []
    const run = vi.fn(() => { const d = deferred(); pending.push(d); return d.promise })
    const trigger = coalescedRefresh(run)
    trigger(); trigger()
    pending[0].resolve(); await flush()
    trigger()
    pending[1].resolve(); await flush()
    expect(run).toHaveBeenCalledTimes(3)
    pending[2].resolve(); await flush()
  })

  it('a failed fetch does not wedge later refreshes', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const trigger = coalescedRefresh(run)
    trigger(); await flush()
    trigger(); await flush()
    expect(run).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })

  it('idle again after the burst: the next event runs immediately', async () => {
    const run = vi.fn(() => Promise.resolve())
    const trigger = coalescedRefresh(run)
    trigger(); await flush()
    trigger()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
