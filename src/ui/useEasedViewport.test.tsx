import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { EASE_MS, useEasedViewport } from './useEasedViewport'
import type { Viewport } from './viewport'

const A: Viewport = { x: 0, y: 0, scale: 1 }
const B: Viewport = { x: 100, y: 50, scale: 0.5 }

const setReducedMotion = (reduced: boolean) => {
  window.matchMedia = ((media: string) => ({ matches: reduced && media.includes('prefers-reduced-motion'), media })) as unknown as typeof matchMedia
}

beforeEach(() => {
  vi.useFakeTimers()
  setReducedMotion(false)
})
afterEach(() => vi.useRealTimers())

type Props = { target: Viewport; animate?: boolean; settleKey?: string }
const render = (initial: Props) => renderHook((p: Props) => useEasedViewport(p.target, p.animate ?? true, p.settleKey ?? ''), { initialProps: initial })
const frames = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('useEasedViewport', () => {
  it('starts on the target', () => {
    expect(render({ target: A }).result.current.viewport).toEqual(A)
  })

  it('keeps the old view on the render a new target arrives and does not jump on the next frame', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    expect(result.current.viewport).toEqual(A)
    frames(48)
    expect(result.current.viewport.scale).toBeLessThan(1)
    expect(result.current.viewport.scale).toBeGreaterThan(B.scale)
    expect(result.current.viewport.x).toBeLessThan(B.x)
  })

  it('eases in: the first frame barely moves, so a pan never starts with a jolt', () => {
    const PAN: Viewport = { x: 100, y: 0, scale: 1 }
    const { result, rerender } = render({ target: A })
    rerender({ target: PAN })
    frames(32)
    expect(result.current.viewport.x).toBeGreaterThan(0)
    expect(result.current.viewport.x).toBeLessThan(5)
  })

  it('eases in and out: around halfway in time it is around halfway there', () => {
    const PAN: Viewport = { x: 100, y: 0, scale: 1 }
    const { result, rerender } = render({ target: A })
    rerender({ target: PAN })
    frames(EASE_MS / 2)
    expect(result.current.viewport.x).toBeGreaterThan(30)
    expect(result.current.viewport.x).toBeLessThan(70)
  })

  it('reaches the target after the duration and stays there', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(EASE_MS + 32)
    expect(result.current.viewport).toEqual(B)
    frames(100)
    expect(result.current.viewport).toEqual(B)
  })

  // A 4x zoom about the diagram point (200, 100): that point sits at screen (200, 100) at both ends.
  const CLOSE: Viewport = { x: 150, y: 75, scale: 4 }
  const screenOf = (v: Viewport, p: { x: number; y: number }) => ({ x: (p.x - v.x) * v.scale, y: (p.y - v.y) * v.scale })

  it('zooms straight in: the point that stays put between both views stays put all the way', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: CLOSE })
    for (let i = 0; i < 5; i++) {
      frames(48)
      const at = screenOf(result.current.viewport, { x: 200, y: 100 })
      expect(at.x).toBeCloseTo(200, 6)
      expect(at.y).toBeCloseTo(100, 6)
    }
  })

  it('gives a large zoom more time, so it does not lunge', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: CLOSE })
    frames(EASE_MS + 32)
    expect(result.current.viewport).not.toEqual(CLOSE)
    frames(EASE_MS + 32)
    expect(result.current.viewport).toEqual(CLOSE)
  })

  it('retargets from the displayed view when the target moves mid-ease', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(100)
    const mid = result.current.viewport
    rerender({ target: A })
    expect(result.current.viewport).toEqual(mid)
    frames(EASE_MS + 32)
    expect(result.current.viewport).toEqual(A)
  })

  it('heading holds the previous destination until the render that follows a new target commits', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(100)
    expect(result.current.heading.current).toEqual(B)
    expect(result.current.viewport).not.toEqual(B)
  })

  it('snaps under prefers-reduced-motion', () => {
    setReducedMotion(true)
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    expect(result.current.viewport).toEqual(B)
  })

  it('follows the target immediately, cancelling a running ease, when not animating', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(50)
    const manual = { x: 7, y: 8, scale: 2 }
    rerender({ target: manual, animate: false })
    expect(result.current.viewport).toEqual(manual)
    frames(EASE_MS * 2)
    expect(result.current.viewport).toEqual(manual)
  })

  it('snaps when the settle key changes, such as a resize', () => {
    const { result, rerender } = render({ target: A, settleKey: '800x600' })
    rerender({ target: B, settleKey: '1000x600' })
    expect(result.current.viewport).toEqual(B)
  })
})
