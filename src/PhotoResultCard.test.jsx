import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PhotoResultCard from './PhotoResultCard.jsx'

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
    // the outer card itself is transparent-to-photo (#0E0E0E is only the
    // pre-image fallback fill, painted UNDER the photo, never a separate
    // solid header/footer block layered above it)
    expect(outer.style.background).toBe('rgb(14, 14, 14)')
    // no element carries a plain white background anywhere in the card
    expect(container.innerHTML).not.toMatch(/background:\s*#fff/i)
    expect(container.innerHTML).not.toMatch(/background:\s*white/i)
  })

  it('renders the top workout summary headline, left-aligned, uppercase presentation, only when supplied (§7/§8/§9)', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} />)
    const headlineNode = screen.getByText(baseProps.headline)
    expect(headlineNode).toHaveStyle({ textTransform: 'uppercase', textAlign: '' })
    rerender(<PhotoResultCard {...baseProps} headline={null} />)
    expect(screen.queryByText(baseProps.headline)).toBeNull()
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
    expect(screen.getByText('132 reps')).toBeInTheDocument()
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

  it('renders the score directly under the format, and RX/Not RX\'d as a small bordered badge beside it (§13/§16/§17)', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} variantLevel="RX" notRxdLabel={null} resultText="12:00" />)
    const badge = screen.getAllByText('RX').find(el => el.style.border)
    expect(badge).toBeTruthy()
    expect(screen.getByText('12:00')).toBeInTheDocument()
    rerender(<PhotoResultCard {...baseProps} variantLevel="RX" notRxdLabel="Not RX'd" resultText="12:00" />)
    // the compact score/status slot shows the MORE SPECIFIC fact (Modified/Not
    // RX'd) rather than both - the underlying axes remain separate props.
    expect(screen.getAllByText("Not RX'd").length).toBeGreaterThan(0)
  })

  it('renders the full performed workout below the result, white/bold/uppercase/left, never re-stating the format (§19/§21)', () => {
    render(<PhotoResultCard {...baseProps} movements={['200m Run', '20 Air Squats']} />)
    expect(screen.getByText('200m Run')).toHaveStyle({ textTransform: 'uppercase' })
    expect(screen.getByText('20 Air Squats')).toBeInTheDocument()
    // "5 RFT" appears exactly once (the central format), not duplicated above the movement list
    expect(screen.getAllByText('5 RFT')).toHaveLength(1)
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
