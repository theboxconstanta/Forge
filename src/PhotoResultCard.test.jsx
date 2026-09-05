import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PhotoResultCard from './PhotoResultCard.jsx'

const baseProps = {
  photoUrl: 'https://signed.example/photo.jpg',
  onPhotoError: () => {},
  gymName: 'CrossFit Delta', gymColor: '#3355FF',
  variantLevel: 'RX', notRxdLabel: null,
  structureHeader: { primary: '5 RFT', secondary: null, prescriptionLines: [] },
  movements: ['200 m Run', '20 Air Squats', '20 Push-Ups', '20 Lunges'],
  resultText: '5 rounds complete · 12:00',
  loggedAt: '2026-09-05T17:00:00.000Z',
  lang: 'en',
  t: { shareCardCloseLabel: 'Close' },
}

// The FORGE logo (§22) is always present in the header, so every test that
// needs the actual PHOTO <img> must select it specifically, not just "the
// first <img> in the DOM".
const getPhotoImg = (container) => [...container.querySelectorAll('img')].find(img => img.getAttribute('src') !== '/forge.png')

describe('PhotoResultCard - owner Phase 2.2 final visual contract', () => {
  it('renders a solid black header with the canonical FORGE logo asset and FORGE wordmark (§2/§22)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const logo = [...container.querySelectorAll('img')].find(img => img.getAttribute('src') === '/forge.png')
    expect(logo).toBeTruthy()
    expect(screen.getByText('FORGE')).toBeInTheDocument()
  })

  it('renders the photo as the full body hero image when a URL is given, with no distortion (object-fit: cover)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const img = getPhotoImg(container)
    expect(img).toBeTruthy()
    expect(img.src).toBe(baseProps.photoUrl)
    expect(img.style.objectFit).toBe('cover')
  })

  it('renders a skeleton placeholder, not a broken photo <img>, while photoUrl is null (still loading)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} photoUrl={null} />)
    expect(getPhotoImg(container)).toBeUndefined()
  })

  it('calls onPhotoError when the photo image fails to load - never crashes, never swallows the failure', () => {
    const onPhotoError = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onPhotoError={onPhotoError} />)
    fireEvent.error(getPhotoImg(container))
    expect(onPhotoError).toHaveBeenCalledTimes(1)
  })

  it('shows the dynamic gym name and never hardcodes a tenant name/color (§2/§3/§23 - synthetic tenant test)', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} gymName="CrossFit Delta" gymColor="#3355FF" />)
    expect(screen.getByText('CrossFit Delta')).toBeInTheDocument()
    expect(screen.queryByText('CrossFit C15')).toBeNull()
    expect(screen.queryByText('ThePACK')).toBeNull()
    rerender(<PhotoResultCard {...baseProps} gymName="ThePACK" gymColor="#FF00AA" />)
    expect(screen.getByText('ThePACK')).toBeInTheDocument()
    expect(screen.queryByText('CrossFit Delta')).toBeNull()
  })

  it('uses gyms.primary_color (not a hardcoded lime) as the accent for the result and gym name', () => {
    render(<PhotoResultCard {...baseProps} gymColor="#3355FF" />)
    expect(screen.getByText('CrossFit Delta')).toHaveStyle({ color: '#3355FF' })
    expect(screen.getByText('5 rounds complete · 12:00')).toHaveStyle({ color: '#3355FF' })
  })

  it('falls back to the existing lime accent when no gyms.primary_color is configured', () => {
    render(<PhotoResultCard {...baseProps} gymColor={null} />)
    expect(screen.getByText('5 rounds complete · 12:00')).toHaveStyle({ color: '#ABE73C' })
  })

  it('renders RX/variant status and a secondary Not RX\'d/Modified pill only when the caller supplies one (§6 - axes stay separate)', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} variantLevel="RX" notRxdLabel={null} />)
    expect(screen.getByText('RX')).toBeInTheDocument()
    expect(screen.queryByText("Not RX'd")).toBeNull()
    rerender(<PhotoResultCard {...baseProps} variantLevel="RX" notRxdLabel="Not RX'd" />)
    expect(screen.getByText('RX')).toBeInTheDocument()
    expect(screen.getByText("Not RX'd")).toBeInTheDocument()
  })

  it('renders the full workout structural header + prescription lines directly under RX, and the movement lines below that (§7/§10)', () => {
    render(<PhotoResultCard {...baseProps}
      structureHeader={{ primary: 'Intervals', secondary: '12:00', prescriptionLines: ['5 Rounds'] }}
    />)
    expect(screen.getByText('Intervals')).toBeInTheDocument()
    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('5 Rounds')).toBeInTheDocument()
    expect(screen.getByText('200 m Run')).toBeInTheDocument()
    expect(screen.getByText('20 Air Squats')).toBeInTheDocument()
  })

  it('renders no structural header block when the caller passes null (e.g. a free-text log with no linked format)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} structureHeader={null} movements={[]} />)
    expect(container.textContent).not.toContain('RFT')
  })

  it('never mutates the canonical result string - it is passed through verbatim, only styled via CSS (§13)', () => {
    render(<PhotoResultCard {...baseProps} resultText="5 rounds complete · 12:00" />)
    // exact original-case text node exists in the DOM; only the CSS
    // text-transform (not asserted here, jsdom doesn't compute layout CSS)
    // presents it uppercase on screen.
    expect(screen.getByText('5 rounds complete · 12:00')).toBeInTheDocument()
  })

  it('renders white date/time under the result', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const dateNode = [...container.querySelectorAll('div')].find(el => /09\/05\/2026/.test(el.textContent) && el.children.length === 0)
    expect(dateNode).toBeTruthy()
    expect(dateNode).toHaveStyle({ color: '#fff' })
  })

  it('renders the congratulations message only when supplied (post-save popup), never invented for Journal reuse', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} congratsText={undefined} />)
    expect(screen.queryByText(/nailed it/i)).toBeNull()
    rerender(<PhotoResultCard {...baseProps} congratsText="Congratulations, you nailed it today! 💪" />)
    expect(screen.getByText('Congratulations, you nailed it today! 💪')).toBeInTheDocument()
  })

  it('renders a Share button inside the photo body, in the tenant accent color, only when onShare is supplied', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} onShare={undefined} shareLabel="Share" />)
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    const onShare = vi.fn()
    rerender(<PhotoResultCard {...baseProps} onShare={onShare} shareLabel="Share" gymColor="#3355FF" />)
    const btn = screen.getByRole('button', { name: 'Share' })
    expect(btn).toHaveStyle({ background: '#3355FF' })
    fireEvent.click(btn)
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('renders no close button when onClose is not supplied (Journal inline use, no modal chrome)', () => {
    render(<PhotoResultCard {...baseProps} onClose={undefined} onShare={undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders and wires a close button in the header when onClose IS supplied (post-save modal use)', () => {
    const onClose = vi.fn()
    render(<PhotoResultCard {...baseProps} onClose={onClose} onShare={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
