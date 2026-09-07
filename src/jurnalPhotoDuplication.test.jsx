// FORGE - JOURNAL PHOTO RESULT DUPLICATION REGRESSION (owner live report)
//
// ROOT CAUSE (forensic, confirmed by direct trace of the real render
// path - not a data/list bug): `jurnalEntries` (App.jsx) already
// deduplicates strictly by wod_logs.id via a Map keyed `wodlog-${l.id}` -
// one physical log has always produced exactly one Journal entry. The
// duplication was a RENDERING bug inside that one entry's own card:
// JurnalList unconditionally rendered BOTH `JurnalPhotoResult`
// (PhotoResultCard, showing the resolved movement lines + primary
// result + compact volume/PR) AND the plain movement-list bullets +
// REZULTAT block right below it - the exact same movements/result
// restated a second time in a different format, for every log that had
// a photo. The plain blocks' own original design intent ("stand in as
// the safe fallback" - see JurnalPhotoResult's header comment, predating
// this incident) was never actually wired to be conditional on the photo
// really rendering - it was structurally impossible for one sibling
// conditional to suppress another.
//
// FIX: JurnalPhotoResult now reports its own real availability up to
// JurnalList via `onAvailabilityChange` (true once a photo actually
// resolves, false on a signed-URL fetch failure OR an <img> load
// failure - never a static "photoMedia exists" check). JurnalList uses
// that per-log signal (`photoRenderable`) to show the movement-list/
// REZULTAT blocks ONLY when there is no photo, or the photo failed -
// restoring the ALWAYS-intended fallback behavior instead of unconditional
// duplication. wHasSets (per-set/round breakdown) and notes remain
// unconditional (never shown inside the deliberately-compact photo card
// at all, so never redundant); NEW PR/Volume detail blocks also remain
// unconditional (they carry finer detail - rep-scheme, exact score,
// improvement delta, per-movement breakdown - than the photo card's
// terse one-line summary, so keeping them is additive detail, not
// duplication).
//
// TEST SIGNAL NOTE: PhotoResultCard's own APPROVED, pre-existing design
// legitimately repeats the movement name once inside its auto-composed
// headline ("Strength Sets: Snatch") and again in its own movements list
// below - that overlap is untouched, original, and NOT the bug (verified
// directly during this incident's own forensics - counting raw "Snatch"
// text occurrences is therefore NOT a reliable duplication signal). The
// reliable signal is `t.jurnalResultLabel` ("RESULT") - that label is
// rendered ONLY by the flat REZULTAT block, never anywhere inside
// PhotoResultCard - so its presence/absence precisely indicates whether
// the redundant flat block rendered alongside a successfully-shown photo.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

// JurnalPhotoResult calls getWodLogPhotoSignedUrl({supabase, storagePath}),
// which calls supabase.storage.from('wod-photos').createSignedUrl(...) -
// mocked here (module-scoped, isolated to this test file) so photo
// resolution is deterministic without a real network/Supabase project.
const createSignedUrlMock = vi.fn()
vi.mock('./supabase.js', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (...args) => createSignedUrlMock(...args) }) } },
}))

import { JurnalList } from './App.jsx'
import { getT } from './translations.js'

afterEach(() => {
  cleanup()
  createSignedUrlMock.mockReset()
})

const t = getT('en')

function makeWodLog(overrides = {}) {
  return {
    id: 'wlog-photo-1',
    logged_at: '2026-09-09T10:00:00Z',
    variant_level: 'rx',
    notes: '',
    sets: {},
    result: '75kg',
    time_result: null,
    log_meta: null,
    format_snapshot: 'Strength Sets',
    format_config_snapshot: { setsScheme: [5] },
    prescription_snapshot: null,
    movements_snapshot: ['Snatch'],
    workout_section_id: null,
    wods: null,
    wod_name_snapshot: null,
    performance_identity_id: null,
    wod_log_media: [{ storage_path: 'g1/m1/wlog-photo-1/photo.jpg' }],
    performed_prescription: null,
    weight_logged: null,
    ...overrides,
  }
}

const entriesFor = (logs) => logs.map((w) => ({ key: w.id, wodLog: w, skillLogsArr: [] }))
// PhotoResultCard's own member-photo <img data-role="member-photo"> -
// distinct from the FORGE logo <img>, which also carries alt="".
const memberPhotoImgs = () => document.querySelectorAll('img[data-role="member-photo"]')
const renderPhotoOk = () => {
  const imgs = memberPhotoImgs()
  if (imgs.length === 0) throw new Error('no member-photo img yet')
  return imgs[0]
}

describe('Journal - one log with a photo shows the photo card WITHOUT the redundant flat blocks', () => {
  it('A/B - photo resolves successfully: the flat movement-bullet + REZULTAT blocks never render alongside it', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(createSignedUrlMock).toHaveBeenCalled())
    await waitFor(() => expect(renderPhotoOk()).toBeInTheDocument())
    // The photo card itself shows the movement (its own approved,
    // pre-existing headline+list design - unrelated to this bug).
    expect(screen.getAllByText(/Snatch/).length).toBeGreaterThan(0)
    // The redundant flat REZULTAT block ("RESULT" label) must be absent -
    // this is the exact duplication the owner reported.
    expect(screen.queryByText(t.jurnalResultLabel)).not.toBeInTheDocument()
    // The flat movement-bullet block's own "• " prefix must be absent too.
    expect(screen.queryByText((_, el) => el?.textContent?.startsWith('• Snatch'))).not.toBeInTheDocument()
  })

  it('D - a signed-URL fetch FAILURE falls back to the plain blocks (never an empty/broken card)', async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: new Error('object not found') })
    render(<JurnalList entries={entriesFor([makeWodLog({ id: 'wlog-photo-fail' })])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(createSignedUrlMock).toHaveBeenCalled())
    // No photo <img> ever mounts (fetch never resolved a URL).
    await waitFor(() => expect(screen.getByText(t.jurnalResultLabel)).toBeInTheDocument())
    expect(memberPhotoImgs()).toHaveLength(0)
    expect(screen.getAllByText(/Snatch/).length).toBe(1) // the flat bullet, exactly once
  })

  it('C - a re-fetch (component re-render with the same storagePath) still resolves to exactly one photo card, flat blocks stay suppressed', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    const log = makeWodLog({ id: 'wlog-photo-refetch' })
    const { rerender } = render(<JurnalList entries={entriesFor([log])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(renderPhotoOk()).toBeInTheDocument())
    expect(memberPhotoImgs()).toHaveLength(1)
    // Re-render with a new entries array reference (same underlying log/id/storagePath) - simulates a parent refetch.
    rerender(<JurnalList entries={entriesFor([{ ...log }])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(memberPhotoImgs()).toHaveLength(1))
    expect(screen.queryByText(t.jurnalResultLabel)).not.toBeInTheDocument()
  })

  it('E - a workout with a real per-set breakdown (wHasSets) KEEPS that breakdown visible even when the photo renders - unique content, never shown inside the compact photo card', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    const log = makeWodLog({
      id: 'wlog-photo-sets',
      sets: { Snatch: [{ completed: true, distance: '', reps: '5', targetReps: 5, weight: '65' }] },
    })
    render(<JurnalList entries={entriesFor([log])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(renderPhotoOk()).toBeInTheDocument())
    // The per-set breakdown line (Set 1: 5 reps @ 65) is unique content,
    // never shown inside the compact photo card - must remain visible.
    expect(screen.getByText(/5 reps/)).toBeInTheDocument()
    // The redundant flat blocks still stay suppressed.
    expect(screen.queryByText(t.jurnalResultLabel)).not.toBeInTheDocument()
  })
})

describe('Journal - two distinct logs (one with photo, one without) both render, no cross-log duplication', () => {
  it('two logs -> two entries, each rendering independently and correctly', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    const logWithPhoto = makeWodLog({ id: 'wlog-a', movements_snapshot: ['Snatch'] })
    const logNoPhoto = makeWodLog({ id: 'wlog-b', movements_snapshot: ['Back Squat'], wod_log_media: null, result: '100kg' })
    render(<JurnalList entries={entriesFor([logWithPhoto, logNoPhoto])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(renderPhotoOk()).toBeInTheDocument())
    // Exactly one photo card (for logWithPhoto only).
    expect(memberPhotoImgs()).toHaveLength(1)
    // logNoPhoto renders its own plain bullet + REZULTAT block normally, unaffected.
    expect(screen.getByText(/Back Squat/)).toBeInTheDocument()
    expect(screen.getByText(t.jurnalResultLabel)).toBeInTheDocument() // logNoPhoto's own REZULTAT block
  })
})

describe('Journal - no-photo workout: existing behavior fully unchanged', () => {
  it('F - a log with no wod_log_media never mounts JurnalPhotoResult, plain blocks render exactly as before', () => {
    const log = makeWodLog({ id: 'wlog-no-photo', wod_log_media: null })
    render(<JurnalList entries={entriesFor([log])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    expect(screen.getByText(/Snatch/)).toBeInTheDocument()
    expect(screen.getByText(t.jurnalResultLabel)).toBeInTheDocument()
    expect(createSignedUrlMock).not.toHaveBeenCalled()
    expect(memberPhotoImgs()).toHaveLength(0)
  })
})

describe('Journal - Photo Result secondary metrics remain intact (Part F of the required tests)', () => {
  it('Total Weight Lifted / NEW PR compact lines still appear inside the (now-exclusive) photo card', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    const snatchInst = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }
    const log = makeWodLog({
      id: 'wlog-photo-volume',
      sets: { Snatch: [{ completed: true, distance: '', reps: '5', targetReps: 5, weight: '65' }] },
      prescription_snapshot: { movements: [snatchInst] },
    })
    render(<JurnalList entries={entriesFor([log])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(renderPhotoOk()).toBeInTheDocument())
    // 5*65=325kg - the compact line inside the photo card's bottom bar.
    expect(screen.getByText('325kg total')).toBeInTheDocument()
    // The fuller flat Volume detail block also stays visible (unconditional
    // by design - it carries per-movement detail the compact line omits,
    // additive, not a duplicate of the SAME fact at the SAME granularity).
    expect(screen.getByText(/Total Weight Lifted/)).toBeInTheDocument()
  })
})
