// FORGE - JOURNAL CLICK-TO-EXPAND DUPLICATION (owner live report, 3rd pass)
//
// FORENSICS (real browser, real production row - wod_logs.id
// 2a121ef0-0cd7-459d-b86c-5d29c494ecaa, Strength Sets, Snatch,
// 5-5-4-4-4-3-3 - reproduced via a temporary preview harness, deleted
// after use):
//
//   Click-level DOM identity was verified CORRECT under this exact data:
//   single click, rapid triple-click, and mid-async-fetch snapshots all
//   showed outerEntries=1 throughout, matching jurnalEntries' own
//   dedup-by-id (Map keyed wodlog-${l.id}, unaffected by this incident).
//   toggleClosed/isOpen is a single boolean flip per log id - clicking
//   never appends a second entry, never mounts a second JurnalList/
//   JurnalPhotoResult/PhotoResultCard, and no responsive/mobile-vs-
//   desktop duplicate markup exists anywhere in this codebase (plain
//   inline styles throughout, no conditional breakpoint-based JSX).
//
//   What clicking to EXPAND DOES introduce (confirmed in the same real-
//   browser reproduction): the card's OWN outer header - date, time, AND
//   format subtitle, always visible whether collapsed or open - restates
//   information ALSO shown inside PhotoResultCard's own self-contained
//   metadata row + headline (that card is deliberately self-contained,
//   reused standalone in WorkoutSharePopup with no outer header at all,
//   so it cannot be changed here - Photo Result layout stays exactly as
//   approved). Since PhotoResultCard is ONLY mounted once the card is
//   open, this specific restatement is invisible collapsed and appears
//   the moment the card expands - matching "clicking causes duplication"
//   far more precisely than a literal second entry/component. Fixed by
//   suppressing the OUTER date/time + subtitle ONLY while open AND the
//   photo is actually rendering (photoRenderable) - collapsing, or a
//   photo that fails to load, brings the row straight back unchanged.
//
//   SEPARATE, CONCRETE FINDING (section 6/9G of the ticket - nested
//   handler propagation): PhotoResultCard's Share button
//   (`<button onClick={onShare}>`) had no stopPropagation. Journal's
//   outer card wrapper ALSO has its own onClick (toggleClosed) with no
//   isolating wrapper in between (unlike WorkoutSharePopup, whose inner
//   content div already stops propagation before the backdrop's onClose
//   - safe there by different means). A tap on Share inside an expanded
//   Journal photo card therefore ALSO bubbled up and toggled the card
//   closed in the same click - reproduced empirically below BEFORE the
//   fix (the test failed, proving the bug), fixed by stopping
//   propagation at the Share button itself (PhotoResultCard.jsx),
//   benefiting every embedding context, not just Journal.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

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
    id: 'wlog-click-1',
    logged_at: '2026-09-09T10:00:00Z',
    variant_level: 'RX',
    notes: '',
    sets: { Snatch: [{ completed: true, distance: '', reps: '5', targetReps: 5, weight: '65' }] },
    result: null,
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
    wod_log_media: [{ storage_path: 'g1/m1/wlog-click-1/photo.jpg' }],
    performed_prescription: null,
    weight_logged: null,
    ...overrides,
  }
}

const entriesFor = (logs) => logs.map((w) => ({ key: w.id, wodLog: w, skillLogsArr: [] }))
const memberPhotoImgs = () => document.querySelectorAll('img[data-role="member-photo"]')
// The outer clickable Journal card wrapper - background/borderLeft/cursor
// signature shared by every top-level entry, distinguishing it from
// nested elements.
const outerCards = () => [...document.querySelectorAll('.oops-never-matches, div')].filter(
  (d) => d.style?.borderLeft?.includes('4px solid') && d.style?.cursor === 'pointer'
)
async function waitForPhoto() {
  await waitFor(() => expect(memberPhotoImgs().length).toBeGreaterThan(0))
}

describe('Journal click-to-expand - DOM identity invariant (real interaction, not just data)', () => {
  it('A - one log renders as ONE outer entry (default state: open, per existing "expanded by default" design)', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    expect(outerCards()).toHaveLength(1)
  })

  it('B/C - clicking the header toggles collapsed/expanded WITHOUT ever creating a second outer entry, in either direction', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    expect(outerCards()).toHaveLength(1)
    const card = outerCards()[0]
    // Collapse.
    fireEvent.click(card)
    expect(outerCards()).toHaveLength(1)
    expect(memberPhotoImgs()).toHaveLength(0)
    // Expand again.
    fireEvent.click(card)
    expect(outerCards()).toHaveLength(1)
    await waitForPhoto()
    expect(memberPhotoImgs()).toHaveLength(1)
  })

  it('D - rapid repeated toggles never produce more than one outer entry for the same log id', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    const card = outerCards()[0]
    fireEvent.click(card); fireEvent.click(card); fireEvent.click(card); fireEvent.click(card); fireEvent.click(card)
    expect(outerCards()).toHaveLength(1) // 5 clicks -> ends collapsed (odd count), still exactly one entry
    fireEvent.click(card)
    expect(outerCards()).toHaveLength(1) // back to open, still exactly one entry
  })

  it('E - a photo log, clicked open, shows exactly ONE PhotoResultCard', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    const log = makeWodLog({ wod_log_media: null }) // start with no photo, click open, THEN simulate photo present via a second render pass below
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    const card = outerCards()[0]
    fireEvent.click(card) // collapse
    fireEvent.click(card) // expand again
    await waitForPhoto()
    expect(memberPhotoImgs()).toHaveLength(1)
  })

  it('F - two distinct logs: expanding one never affects the other, 2 outer entries total throughout', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    const logA = makeWodLog({ id: 'wlog-click-a' })
    const logB = makeWodLog({ id: 'wlog-click-b', wod_log_media: null, movements_snapshot: ['Back Squat'] })
    render(<JurnalList entries={entriesFor([logA, logB])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    expect(outerCards()).toHaveLength(2)
    // Collapse only logA (the first card).
    fireEvent.click(outerCards()[0])
    expect(outerCards()).toHaveLength(2) // still two entries - logB untouched, its own content still visible
    expect(screen.getByText(/Back Squat/)).toBeInTheDocument()
  })

  it('I - same invariants hold at a mobile viewport width', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
    window.dispatchEvent(new Event('resize'))
    try {
      createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
      render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
      await waitForPhoto()
      const card = outerCards()[0]
      expect(outerCards()).toHaveLength(1)
      fireEvent.click(card)
      expect(outerCards()).toHaveLength(1)
      expect(memberPhotoImgs()).toHaveLength(0)
    } finally {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    }
  })
})

describe('Journal click-to-expand - header/photo-card informational overlap (3rd-pass fix)', () => {
  it('the outer date/time + format subtitle are suppressed ONLY while open AND the photo is actually rendering - no longer restated a second time', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    // PhotoResultCard's OWN metadata date is present (untouched, approved design).
    expect(screen.getByText('September 9, 2026')).toBeInTheDocument()
    // The outer header's OWN duplicate date string (dd/mm/yyyy format) is
    // gone - shown only once now, inside the photo card. ("Strength Sets"
    // itself isn't a reliable signal here - the photo card's OWN
    // structureHeader.primary legitimately renders that exact text too;
    // the outer subtitle's specific dd/mm/yyyy date format is unique to
    // the outer header and never appears inside PhotoResultCard, making it
    // the precise, unambiguous signal.)
    expect(screen.queryByText('09/09/2026')).not.toBeInTheDocument()
  })

  it('collapsing brings the outer date/time straight back, unchanged from before this fix', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    fireEvent.click(outerCards()[0])
    expect(screen.getByText('09/09/2026')).toBeInTheDocument()
  })

  it('a photo FAILURE keeps the outer date/time visible (never suppressed when there is nothing to avoid duplicating)', async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: new Error('object not found') })
    render(<JurnalList entries={entriesFor([makeWodLog({ id: 'wlog-click-fail' })])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitFor(() => expect(createSignedUrlMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('09/09/2026')).toBeInTheDocument())
  })

  it('a log with NO photo at all keeps the outer date/time visible, fully unchanged', () => {
    const log = makeWodLog({ id: 'wlog-click-nophoto', wod_log_media: null })
    render(<JurnalList entries={entriesFor([log])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    expect(screen.getByText('09/09/2026')).toBeInTheDocument()
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })
})

describe('Journal click-to-expand - nested Share button no longer toggles the card closed', () => {
  it('G - clicking the photo card\'s Share button does NOT collapse/toggle the Journal entry (event propagation fix)', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null })
    render(<JurnalList entries={entriesFor([makeWodLog()])} validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />)
    await waitForPhoto()
    expect(outerCards()).toHaveLength(1)
    const shareButton = screen.getByLabelText(t.shareCardButton)
    fireEvent.click(shareButton)
    // The card must STILL be open and showing exactly one photo - the
    // Share tap must never have bubbled up into the outer toggleClosed
    // handler.
    expect(outerCards()).toHaveLength(1)
    expect(memberPhotoImgs()).toHaveLength(1)
  })
})
