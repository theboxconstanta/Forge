import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBenchmarkNames } from './benchmarkResolution'
import { supabase } from './supabase.js'

vi.mock('./supabase.js', () => ({
  supabase: { rpc: vi.fn() },
}))

beforeEach(() => {
  supabase.rpc.mockReset()
})

describe('resolveBenchmarkNames (parity with forge-admin-web\'s own benchmarkResolution.ts)', () => {
  it('returns an empty map without calling the RPC when there is nothing to resolve', async () => {
    const result = await resolveBenchmarkNames([null, undefined, '', '   '])
    expect(result.size).toBe(0)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('deduplicates before calling the RPC, and calls it exactly once', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null })
    await resolveBenchmarkNames(['Fran', 'Fran', 'Murph', 'Fran'])
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_benchmark_names', { p_names: ['Fran', 'Murph'] })
  })

  it('keys the returned map by the original input string', async () => {
    supabase.rpc.mockResolvedValue({
      data: [{ input_name: 'fran', benchmark_id: 'b1', canonical_name: 'Fran', category: 'girl', is_platform: true }],
      error: null,
    })
    const result = await resolveBenchmarkNames(['fran'])
    expect(result.get('fran')).toEqual({ benchmarkId: 'b1', canonicalName: 'Fran', category: 'girl', isPlatform: true })
  })

  it('omits an unresolved name from the map entirely', async () => {
    supabase.rpc.mockResolvedValue({
      data: [{ input_name: 'Tuesday Metcon', benchmark_id: null, canonical_name: null, category: null, is_platform: null }],
      error: null,
    })
    const result = await resolveBenchmarkNames(['Tuesday Metcon'])
    expect(result.has('Tuesday Metcon')).toBe(false)
  })

  it('throws when the RPC itself errors', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('network down') })
    await expect(resolveBenchmarkNames(['Fran'])).rejects.toThrow()
  })
})
