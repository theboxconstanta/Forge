import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PhotoResultCard from './PhotoResultCard.jsx'

const baseProps = {
  photoUrl: 'https://signed.example/photo.jpg',
  onPhotoError: () => {},
  gymName: 'CrossFit Delta', gymColor: '#ABE73C',
  wodName: 'Fran', variantLevel: 'RX', variantColor: '#0E0E0E', variantBg: '#f0f0f0',
  notRxdLabel: null,
  movements: ['21 Thrusters @ 43 kg', '21 Pull-ups'],
  resultText: '5:12',
  loggedAt: '2026-09-05T10:30:00.000Z',
  lang: 'en',
  t: { shareCardCloseLabel: 'Close' },
}

describe('PhotoResultCard - pure presentation, owner Phase 2 §3/§4/§13', () => {
  it('renders the photo as the hero image when a URL is given', () => {
    const { container } = render(<PhotoResultCard {...baseProps} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.src).toBe(baseProps.photoUrl)
    expect(img.style.objectFit).toBe('cover')
  })

  it('renders a skeleton placeholder, not a broken <img>, while photoUrl is null (still loading)', () => {
    const { container } = render(<PhotoResultCard {...baseProps} photoUrl={null} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('calls onPhotoError when the image fails to load - never crashes, never swallows the failure', () => {
    const onPhotoError = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onPhotoError={onPhotoError} />)
    fireEvent.error(container.querySelector('img'))
    expect(onPhotoError).toHaveBeenCalledTimes(1)
  })

  it('shows canonical result truth in the overlay: gym identity, variant, movements (performed truth as given), score, date', () => {
    render(<PhotoResultCard {...baseProps} />)
    expect(screen.getByText('FORGE')).toBeInTheDocument()
    expect(screen.getByText('CrossFit Delta')).toBeInTheDocument()
    expect(screen.getByText('RX')).toBeInTheDocument()
    expect(screen.getByText('21 Thrusters @ 43 kg')).toBeInTheDocument()
    expect(screen.getByText('21 Pull-ups')).toBeInTheDocument()
    expect(screen.getByText('5:12')).toBeInTheDocument()
  })

  it('shows the Not RX\'d / Modified label only when the caller supplies one - the axis is decided entirely by the caller', () => {
    const { rerender } = render(<PhotoResultCard {...baseProps} notRxdLabel={null} />)
    expect(screen.queryByText("Not RX'd")).toBeNull()
    rerender(<PhotoResultCard {...baseProps} notRxdLabel="Not RX'd" />)
    expect(screen.getByText("Not RX'd")).toBeInTheDocument()
  })

  it('never fabricates gym branding beyond gyms.name/gyms.primary_color - no tagline, no hardcoded gym name', () => {
    render(<PhotoResultCard {...baseProps} gymName={null} />)
    expect(screen.queryByText('CrossFit Delta')).toBeNull()
    expect(screen.getByText('FORGE')).toBeInTheDocument() // the platform brand only, unconditional
  })

  it('renders no close button when onClose is not supplied (Journal inline use, no modal chrome)', () => {
    render(<PhotoResultCard {...baseProps} onClose={undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders and wires a close button when onClose IS supplied (post-save modal use)', () => {
    const onClose = vi.fn()
    render(<PhotoResultCard {...baseProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
