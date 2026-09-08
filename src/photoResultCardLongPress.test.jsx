// LONG PRESS ON PHOTO DOES NOT TRIGGER SHARE - interaction tests for the
// gesture added to PhotoResultCard.jsx. The owner's live iPhone test
// confirmed the top-right Share button's canonical export/share pipeline
// works correctly (bd8ede1) - this file is ONLY about the new ~2s hold
// gesture reaching that exact same `onShare` prop, never a second
// export/share implementation.
//
// iOS SAFARI USER-ACTIVATION - grounded via WebKit's own "The User
// Activation API" engineering blog and the W3C Web Share API spec
// (transient activation is a short, browser-internal timer that does not
// reliably survive an async gap like `setTimeout`; Mozilla bug 1643205
// "Navigator's share() must consume user activation") - a direct
// `onShare()` call from the 2s timer callback risks losing that
// activation and silently downgrading every long-press share to a local
// file download instead of the real native Share Sheet. So the completed
// hold reveals a small contextual "Share" chip instead of calling
// `onShare` itself - the user's OWN subsequent tap on that chip is what
// actually invokes the canonical action, under activation guaranteed
// valid on every engine (the same guarantee the top-right button already
// has, live-verified). Tests B/C below verify that two-step contract
// directly, per owner §7's explicit "preferred fallback" instruction - no
// real iPhone was available in this session to test the gesture itself,
// see the release report.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, act } from '@testing-library/react'
import PhotoResultCard from './PhotoResultCard.jsx'

// The gesture's own `setTimeout` callback triggers a React state update
// (revealing the chip) - fake-timer advances that cross that boundary must
// be wrapped in act() so React actually flushes/re-renders before the
// assertion runs, exactly as it would in a real browser tick.
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms) })

const baseProps = {
  photoUrl: 'https://signed.example/photo.jpg',
  onPhotoError: () => {},
  gymName: 'CrossFit Delta', gymColor: '#3355FF',
  variantLevel: 'RX', notRxdLabel: null,
  structureHeader: { primary: '5 RFT', timeCap: null, intrinsicDuration: null, prescriptionLines: [] },
  headline: '5 RFT: 200m Run, 20 Air Squats',
  movements: ['200m Run', '20 Air Squats'],
  resultText: '12:00',
  loggedAt: '2026-09-05T17:00:00.000Z', lang: 'en',
  t: { shareCardCloseLabel: 'Close', shareCardButton: 'Share' },
}

const getChip = (container) => container.querySelector('button[data-role="long-press-share-chip"]')

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('LONG PRESS ON PHOTO DOES NOT TRIGGER SHARE - gesture contract', () => {
  it('A - a hold released before 2s never shows the chip or calls onShare', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    advance(1500)
    fireEvent.pointerUp(root, { clientX: 100, clientY: 100 })
    fireEvent.click(root)
    expect(getChip(container)).toBeNull()
    expect(onShare).not.toHaveBeenCalled()
  })

  it('B - holding for >=2s reveals the contextual Share chip WITHOUT itself calling onShare (owner §7 user-activation-safe deferral)', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    advance(2000)
    expect(getChip(container)).toBeTruthy()
    expect(onShare).not.toHaveBeenCalled() // NOT called directly from the timer - see file header
  })

  it('C - tapping the revealed chip in a SEPARATE, later tap (a fresh, direct user gesture) invokes the canonical onShare exactly once and hides the chip again', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    advance(2000)
    fireEvent.pointerUp(root, { clientX: 100, clientY: 100 })
    fireEvent.click(root) // the browser's own release-click, following the hold - suppressed (owner §4/§8C, covered by test I)
    expect(onShare).not.toHaveBeenCalled()
    // a genuinely separate, later tap directly on the chip
    fireEvent.pointerDown(getChip(container), { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(getChip(container), { clientX: 100, clientY: 100 })
    fireEvent.click(getChip(container))
    expect(onShare).toHaveBeenCalledTimes(1)
    expect(getChip(container)).toBeNull()
  })

  it('D - small finger jitter during the hold does not cancel it - the chip still appears at 2s', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(root, { clientX: 103, clientY: 101 }) // ~3px - well under the 12px tolerance
    advance(2000)
    expect(getChip(container)).toBeTruthy()
  })

  it('E - meaningful drag/scroll movement during the hold cancels it - no chip, no share', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(root, { clientX: 100, clientY: 150 }) // 50px - a real scroll/drag
    advance(2000)
    expect(getChip(container)).toBeNull()
    expect(onShare).not.toHaveBeenCalled()
  })

  it('F - pointercancel during the hold cancels it - no chip, no share', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    fireEvent.pointerCancel(root)
    advance(2000)
    expect(getChip(container)).toBeNull()
    expect(onShare).not.toHaveBeenCalled()
  })

  it('G - a normal (quick) tap fires no share action and is NOT swallowed - it still reaches an outer click handler exactly as before this gesture existed', () => {
    const onShare = vi.fn()
    const outerClick = vi.fn()
    const { container } = render(
      <div onClick={outerClick}><PhotoResultCard {...baseProps} onShare={onShare} /></div>
    )
    const root = container.firstChild.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(root, { clientX: 100, clientY: 100 })
    fireEvent.click(root)
    expect(onShare).not.toHaveBeenCalled()
    expect(outerClick).toHaveBeenCalledTimes(1) // Journal's own toggleClosed-equivalent still fires for a normal tap
  })

  it('H - the top-right Share button invokes the exact same onShare prop as the long-press chip - one canonical action, two triggers', () => {
    const onShare = vi.fn()
    render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('I - releasing after a completed long press does not bubble into an outer click handler (Journal toggle stays untouched)', () => {
    const onShare = vi.fn()
    const outerClick = vi.fn()
    const { container } = render(
      <div onClick={outerClick}><PhotoResultCard {...baseProps} onShare={onShare} /></div>
    )
    const root = container.firstChild.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    advance(2000)
    fireEvent.pointerUp(root, { clientX: 100, clientY: 100 })
    fireEvent.click(root) // the browser's own click following the completed hold
    expect(outerClick).not.toHaveBeenCalled()
  })

  it('J - unmounting mid-hold cleans up the timer - it never fires (no chip, no error) after the component is gone', () => {
    const onShare = vi.fn()
    const { container, unmount } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    unmount()
    expect(() => advance(2000)).not.toThrow()
    expect(onShare).not.toHaveBeenCalled()
  })

  it('K - rapid repeated (incomplete) presses never leave a stray timer that fires later, and never produce more than one chip/share from one completed hold', () => {
    const onShare = vi.fn()
    const { container } = render(<PhotoResultCard {...baseProps} onShare={onShare} />)
    const root = container.firstChild
    // three rapid, incomplete presses
    for (let i = 0; i < 3; i++) {
      fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
      advance(200)
      fireEvent.pointerUp(root, { clientX: 100, clientY: 100 })
      fireEvent.click(root)
    }
    advance(2000) // nothing pending should fire this late
    expect(getChip(container)).toBeNull()
    expect(onShare).not.toHaveBeenCalled()
    // now a real completed hold
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    advance(2000)
    expect(getChip(container)).toBeTruthy()
    fireEvent.pointerUp(root, { clientX: 100, clientY: 100 })
    fireEvent.click(root) // suppressed release-click
    fireEvent.pointerDown(getChip(container), { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(getChip(container), { clientX: 100, clientY: 100 })
    fireEvent.click(getChip(container)) // separate, later tap on the chip
    expect(onShare).toHaveBeenCalledTimes(1) // exactly one, never duplicated
  })

  it('no long-press handling is wired when onShare is not supplied (export mode / no-share reuse) - no chip ever, no crash on hold', () => {
    const { container } = render(<PhotoResultCard {...baseProps} onShare={undefined} onClose={undefined} />)
    const root = container.firstChild
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100 })
    advance(2000)
    expect(getChip(container)).toBeNull()
  })
})
