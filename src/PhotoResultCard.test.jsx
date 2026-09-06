import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import PhotoResultCard from './PhotoResultCard.jsx'

const __dirname = dirname(fileURLToPath(import.meta.url))

const baseProps = {
  photoUrl: 'https://signed.example/photo.jpg',
  onPhotoError: () => {},
  gymName: 'CrossFit Delta', gymColor: '#3355FF',
  variantLevel: 'RX', notRxdLabel: null,
  structureHeader: { primary: '5 RFT', timeCap: null, intrinsicDuration: null, prescriptionLines: [] },
  headline: '5 RFT: 200m Run, 20 Air Squats, 20 Push-Ups, and 1 more',
  movements: ['200m Run', '20 Air Squats', '20 Push-Ups', '20 Lunges'],
  resultText: '12:00',
  loggedAt: '2026-09-05T17:00:00.000Z',
  lang: 'en',
  t: { shareCardCloseLabel: 'Close', shareCardButton: 'Share' },
}

// The FORGE logo (§26) always sits in the bottom bar, so any test needing
// the actual PHOTO <img> must select it specifically.
const getPhotoImg = (container) => [...container.querySelectorAll('img')].find(img => img.getAttribute('src') !== '/forge.png')

describe('PhotoResultCard - owner Phase 2.4 pixel-faithful visual contract', () => {
  it('renders the member\'s own photo as the full-body hero, no distortion (object-fit: cover) - §1/§5', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const img = getPhotoImg(container)
    expect(img).toBeTruthy()
    expect(img.src).toBe(baseProps.photoUrl)
    expect(img.style.objectFit).toBe('cover')
  })

  it('never applies a grayscale/desaturate filter - the original color photo remains visible under the scrim (§4/§29/§43)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const img = getPhotoImg(container)
    expect(img.style.filter).toBe('')
    const html = container.innerHTML
    expect(html).not.toMatch(/grayscale/i)
    expect(html).not.toMatch(/saturate\(0/i)
  })

  it('renders a skeleton placeholder, not a broken photo <img>, while photoUrl is null (still loading)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} photoUrl={null} />)
    expect(getPhotoImg(container)).toBeUndefined()
  })

  it('calls onPhotoError when the photo image fails to load', () => {
    const onPhotoError = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onPhotoError={onPhotoError} />)
    fireEvent.error(getPhotoImg(container))
    expect(onPhotoError).toHaveBeenCalledTimes(1)
  })

  it('renders no separate black header and no white footer - the card is one continuous element with a transparent-to-photo body (§3)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const outer = container.firstChild
    expect(outer.style.background).toBe('rgb(14, 14, 14)')
    expect(container.innerHTML).not.toMatch(/background:\s*#fff/i)
    expect(container.innerHTML).not.toMatch(/background:\s*white/i)
  })

  it('renders the top workout summary headline, left-aligned, uppercase, only when supplied (owner Phase 5 §2)', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} />)
    const headlineNode = screen.getByText(baseProps.headline)
    expect(headlineNode).toHaveStyle({ textTransform: 'uppercase' })
    rerender(<PhotoResultCard {...baseProps} headline={null} />)
    expect(screen.queryByText(baseProps.headline)).toBeNull()
  })

  it('the top headline\'s font-size is materially smaller than the central format\'s (owner Phase 5 §2) - jsdom cannot compute clamp() layout, so this checks the authored source directly, guarding against a future edit re-widening it', () => {
    const src = readFileSync(join(__dirname, 'PhotoResultCard.jsx'), 'utf8')
    const headlineMax = Number(src.match(/TOP WORKOUT SUMMARY[\s\S]*?fontSize: 'clamp\([\d.]+px, [\d.]+vw, ([\d.]+)px\)'/)?.[1])
    const formatMax = Number(src.match(/Central block[\s\S]{0,400}?fontSize: 'clamp\([\d.]+px, [\d.]+vw, ([\d.]+)px\)'/)?.[1])
    expect(headlineMax).toBeGreaterThan(0)
    expect(formatMax).toBeGreaterThan(0)
    expect(headlineMax).toBeLessThan(formatMax)
  })

  it('renders a thin divider below the summary (§10)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const divider = [...container.querySelectorAll('div[aria-hidden="true"]')].find(d => d.style.height === '1px')
    expect(divider).toBeTruthy()
  })

  it('renders the metadata row (gym/date/time) with icons, gym from gyms.name, never hardcoded (§11/§12/§37)', () => {
    render(<PhotoResultCard {...baseProps} gymName="CrossFit Delta" />)
    expect(screen.getByText('CrossFit Delta')).toBeInTheDocument()
    expect(screen.getByText(/September 5, 2026/)).toBeInTheDocument()
  })

  it('renders the actual prescribed format large and in gyms.primary_color, never hardcoded lime (§14/§15/§29)', () => {
    render(<PhotoResultCard {...baseProps} structureHeader={{ primary: 'AMRAP', timeCap: null, intrinsicDuration: '15:00', prescriptionLines: [] }} gymColor="#3355FF" resultText="132 reps" />)
    expect(screen.getByText('AMRAP')).toHaveStyle({ color: '#3355FF' })
    expect(screen.getByText('15:00')).toBeInTheDocument()
  })

  it('falls back to the existing lime accent only when no gyms.primary_color is configured', () => {
    render(<PhotoResultCard {...baseProps} gymColor={null} />)
    expect(screen.getByText('5 RFT')).toHaveStyle({ color: '#ABE73C' })
  })

  it('owner universal hierarchy - a genuine Time Cap renders ONCE, in its own TOP SECONDARY slot, never folded into the center format label', () => {
    render(<PhotoResultCard {...baseProps} structureHeader={{ primary: 'FOR TIME', timeCap: 'TIME CAP 10:00', intrinsicDuration: null, prescriptionLines: [] }} />)
    expect(screen.getAllByText('TIME CAP 10:00')).toHaveLength(1)
    expect(screen.getByText('FOR TIME')).toBeInTheDocument()
  })

  it('owner universal hierarchy - an intrinsic format duration (AMRAP/EMOM) stays combined with the format, never shown a second time as a Time Cap', () => {
    render(<PhotoResultCard {...baseProps} structureHeader={{ primary: 'AMRAP', timeCap: null, intrinsicDuration: '12:00', prescriptionLines: [] }} resultText="132 reps" />)
    expect(screen.getAllByText('12:00')).toHaveLength(1)
    expect(screen.queryByText(/TIME CAP/i)).toBeNull()
  })

  it('the top headline never repeats the time cap or intrinsic duration - only the bare format + movement summary', () => {
    render(<PhotoResultCard {...baseProps}
      structureHeader={{ primary: 'FOR TIME', timeCap: 'TIME CAP 10:00', intrinsicDuration: null, prescriptionLines: [] }}
      headline="FOR TIME: 21 Clean and Jerks, 21 Cal Air Bike, and 1 more"
    />)
    const headline = screen.getByText('FOR TIME: 21 Clean and Jerks, 21 Cal Air Bike, and 1 more')
    expect(headline.textContent).not.toMatch(/TIME CAP/i)
  })

  it('owner Phase 5 §11/§16 - center never shows a standalone score or status - both live exactly once, in the bottom bar only', () => {
    const { container } = render(<PhotoResultCard {...baseProps} variantLevel="RX" notRxdLabel="Not RX'd" resultText="7:00" />)
    // no bordered status badge anywhere in the center content (only the
    // bottom bar's plain joined text may contain these words)
    const borderedBadges = [...container.querySelectorAll('span')].filter(el => el.style.border && /Not RX'd|RX/.test(el.textContent))
    expect(borderedBadges).toHaveLength(0)
    // "7:00" appears exactly once on the whole card (bottom bar only) -
    // it is embedded in a single joined "7:00 | Not RX'd" text node, so
    // count occurrences in the full card text rather than querying for an
    // exact standalone "7:00" node (which the center used to render).
    expect((container.textContent.match(/7:00/g) || []).length).toBe(1)
  })

  it('owner Phase 5 §10/§7 - center shows ONLY the athlete progression (resolveResultMovementLines output), no second full-workout block, no duplicated format', () => {
    render(<PhotoResultCard {...baseProps} movements={['200m Run', '20 Air Squats']} />)
    expect(screen.getByText('200m Run')).toHaveStyle({ textTransform: 'uppercase' })
    expect(screen.getByText('20 Air Squats')).toBeInTheDocument()
    // "5 RFT" appears exactly once (the central format), never duplicated
    expect(screen.getAllByText('5 RFT')).toHaveLength(1)
    // each movement line appears exactly once - no separate redundant block
    expect(screen.getAllByText('200m Run')).toHaveLength(1)
  })

  it('owner Phase 5 §13 - bottom bar contains ONLY the canonical final result + status, never movement/workout text', () => {
    const { container } = render(<PhotoResultCard {...baseProps} movements={['200m Run', '20 Air Squats', '20 Push-Ups', '20 Lunges']} resultText="7:00" variantLevel="RX" />)
    const bottomBar = [...container.querySelectorAll('div')].find(d => d.style.background === 'rgba(0, 0, 0, 0.55)')
    expect(bottomBar).toBeTruthy()
    const bottomBarText = bottomBar.textContent
    expect(bottomBarText).toContain('7:00')
    expect(bottomBarText).toContain('RX')
    expect(bottomBarText).not.toMatch(/200m Run|Air Squats|Push-Ups|Lunges/i)
  })

  it('renders the bottom translucent bar with a result summary on the left and FORGE + logo on the right (§23/§24/§26)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    expect(screen.getByText('FORGE')).toBeInTheDocument()
    const logo = [...container.querySelectorAll('img')].find(img => img.getAttribute('src') === '/forge.png')
    expect(logo).toBeTruthy()
    expect(container.textContent).toContain('12:00 | RX')
  })

  it('renders no workout ordinal element (no canonical per-log ordinal source exists - §25)', () => {
    render(<PhotoResultCard {...baseProps} />)
    expect(screen.queryByText(/wod$/i)).toBeNull()
  })

  it('renders no large Share button inside the card - Share, when present, is a minimal floating icon (§35)', () => {
    const onShare = vi.fn()
    render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const btn = screen.getByRole('button', { name: 'Share' })
    fireEvent.click(btn)
    expect(onShare).toHaveBeenCalledTimes(1)
    expect(Number.parseInt(btn.style.width, 10)).toBeLessThan(40) // small icon button, not a full-width button
  })

  it('renders no share icon when onShare is not supplied (Journal reuse, §34)', () => {
    render(<PhotoResultCard {...baseProps} onShare={undefined} onClose={undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a minimal close icon (application chrome), never a redesigned card, when onClose is supplied (§36)', () => {
    const onClose = vi.fn()
    render(<PhotoResultCard {...baseProps} onClose={onClose} onShare={undefined} />)
    const btn = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(btn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('multi-tenant: gym name/accent change per tenant, FORGE stays FORGE, no tenant literal is hardcoded (§42)', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} gymName="CrossFit Delta" gymColor="#3355FF" />)
    expect(screen.getByText('CrossFit Delta')).toBeInTheDocument()
    expect(screen.getByText('5 RFT')).toHaveStyle({ color: '#3355FF' })
    rerender(<PhotoResultCard {...baseProps} gymName="ThePACK" gymColor="#FF7A00" />)
    expect(screen.getByText('ThePACK')).toBeInTheDocument()
    expect(screen.queryByText('CrossFit Delta')).toBeNull()
    expect(screen.getByText('5 RFT')).toHaveStyle({ color: '#FF7A00' })
    expect(screen.getByText('FORGE')).toBeInTheDocument()
  })
})
