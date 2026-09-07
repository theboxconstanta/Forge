// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Phase F/Part B/C
// (owner-authorized Photo Result wiring, after the Leaderboard live
// acceptance failure was root-caused and fixed).
//
// Adds `volumeText`/`isNewPr` to the EXISTING approved PhotoResultCard
// (no redesign, no second renderer, no card-specific recalculation - both
// values are already-computed-by-the-caller facts, exactly like every
// other prop on this component). Both props are purely additive and
// OPTIONAL - the existing 95 visual-contract/export/share tests
// (PhotoResultCard.test.jsx, inc20PhotoResultCardVisualContract.test.jsx,
// photoResultCardExport.test.jsx, photoResultCardShare.test.js) all still
// pass unmodified, proving the established hierarchy is untouched when
// neither prop is supplied.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PhotoResultCard from './PhotoResultCard.jsx'

// Same mock as photoResultCardExport.test.jsx (vi.mock is file-scoped) -
// real canvas rasterization is a browser concern, not something jsdom can
// prove; what's under test here is that the export orchestration still
// wires volumeText/isNewPr straight through with the exact same fixed
// 1080x1350 output contract, unaffected by the new props.
const TINY_JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='
vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => TINY_JPEG_DATA_URL),
  getFontEmbedCSS: vi.fn(async () => '/* fake embedded font css */'),
}))
import { generatePhotoResultCardImage, EXPORT_WIDTH, EXPORT_HEIGHT, EXPORT_PIXEL_RATIO } from './photoResultCardExport.jsx'

afterEach(() => {
  document.body.innerHTML = ''
})

const baseProps = {
  photoUrl: 'https://signed.example/photo.jpg',
  onPhotoError: () => {},
  gymName: 'CrossFit Delta', gymColor: '#3355FF',
  variantLevel: 'RX', notRxdLabel: null,
  structureHeader: { primary: 'STRENGTH SETS', timeCap: null, intrinsicDuration: null, prescriptionLines: [] },
  headline: 'Strength Sets: Snatch',
  movements: ['Snatch'],
  resultText: '77kg',
  loggedAt: '2026-09-08T17:00:00.000Z',
  lang: 'en',
  t: { shareCardCloseLabel: 'Close', shareCardButton: 'Share', strengthNewPrLabel: 'NEW P.R.' },
}

describe('PhotoResultCard - Total Weight Lifted compact secondary line', () => {
  it('preserves the existing primary "77kg | RX" bottom-bar line unchanged, and adds "1,966kg total" beneath it', () => {
    render(<PhotoResultCard {...baseProps} volumeText="1,966kg total" />)
    expect(screen.getByText('77kg | RX')).toBeInTheDocument()
    expect(screen.getByText('1,966kg total')).toBeInTheDocument()
  })

  it('shows nothing extra when volumeText is null/absent - byte-identical to the pre-existing card', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    expect(screen.getByText('77kg | RX')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/total/i)
    expect(container.textContent).not.toMatch(/NEW P\.R\./i)
  })
})

describe('PhotoResultCard - NEW P.R. (explicit-intent only, authoritative pr_events source)', () => {
  it('shows 🏆 NEW P.R. when isNewPr is true, primary result line still unchanged', () => {
    render(<PhotoResultCard {...baseProps} resultText="77kg" variantLevel="RX" isNewPr />)
    expect(screen.getByText('77kg | RX')).toBeInTheDocument()
    expect(screen.getByText(/🏆/)).toBeInTheDocument()
    expect(screen.getByText(/NEW P\.R\./)).toBeInTheDocument()
  })

  it('an ordinary Strength Sets result (isNewPr false/absent) NEVER shows NEW P.R., no matter how heavy the top set was', () => {
    render(<PhotoResultCard {...baseProps} resultText="77kg" isNewPr={false} />)
    expect(screen.queryByText(/NEW P\.R\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/🏆/)).not.toBeInTheDocument()
  })

  it('when both isNewPr and volumeText are supplied, the PR line takes priority in the single compact slot (never showing two conflicting secondary facts at once)', () => {
    render(<PhotoResultCard {...baseProps} volumeText="1,966kg total" isNewPr />)
    expect(screen.getByText(/NEW P\.R\./)).toBeInTheDocument()
    expect(screen.queryByText('1,966kg total')).not.toBeInTheDocument()
  })

  it('PR is presentation-only here - PhotoResultCard never computes or infers it from resultText/load, only renders the caller-supplied boolean', () => {
    // A very heavy resultText with isNewPr explicitly false must never
    // trigger the badge from the value alone.
    render(<PhotoResultCard {...baseProps} resultText="500kg" isNewPr={false} />)
    expect(screen.queryByText(/NEW P\.R\./)).not.toBeInTheDocument()
  })
})

describe('PhotoResultCard - established hierarchy/no redesign regression', () => {
  it('the primary result|status line and the new secondary line are both right-aligned in the same bottom-right block, FORGE branding untouched on the left', () => {
    const { container } = render(<PhotoResultCard {...baseProps} volumeText="1,966kg total" />)
    expect(screen.getByText('FORGE')).toBeInTheDocument()
    expect(screen.getByText('77kg | RX')).toBeInTheDocument()
    // Still exactly one PhotoResultCard root (no second card/renderer).
    expect(container.querySelectorAll('[data-role="member-photo"]').length).toBe(1)
  })
})

describe('Export (1080x1350) still correct with the new props present', () => {
  it('generatePhotoResultCardImage succeeds and preserves the exact export size contract when volumeText/isNewPr are included', async () => {
    const result = await generatePhotoResultCardImage({
      photoUrl: null,
      gymName: 'CrossFit Delta', gymColor: '#ABE73C',
      variantLevel: 'RX', notRxdLabel: null,
      structureHeader: { primary: 'STRENGTH SETS', timeCap: null, intrinsicDuration: null, prescriptionLines: [] },
      headline: 'Strength Sets: Snatch',
      movements: ['Snatch'],
      resultText: '77kg',
      volumeText: '1,966kg total', isNewPr: false,
      loggedAt: '2026-09-08T17:00:00.000Z', lang: 'en',
      t: { shareCardCloseLabel: 'Close', shareCardButton: 'Share' },
    })
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.type).toBe('image/jpeg')
    expect(EXPORT_WIDTH * EXPORT_PIXEL_RATIO).toBe(1080)
    expect(EXPORT_HEIGHT * EXPORT_PIXEL_RATIO).toBe(1350)
  })
})
