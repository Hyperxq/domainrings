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
    expect(render({ target: A }).result.current).toEqual(A)
  })

  it('keeps the old view on the render a new target arrives and does not jump on the next frame', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    expect(result.current).toEqual(A)
    frames(48)
    expect(result.current.scale).toBeLessThan(1)
    expect(result.current.scale).toBeGreaterThan(B.scale)
    expect(result.current.x).toBeLessThan(B.x)
  })

  it('eases out: past the halfway point of the time it has covered more than half the distance', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(EASE_MS / 2)
    expect(result.current.x).toBeGreaterThan(B.x / 2)
  })

  it('reaches the target after the duration and stays there', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(EASE_MS + 32)
    expect(result.current).toEqual(B)
    frames(100)
    expect(result.current).toEqual(B)
  })

  it('retargets from the displayed view when the target moves mid-ease', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(100)
    const mid = result.current
    rerender({ target: A })
    expect(result.current).toEqual(mid)
    frames(EASE_MS + 32)
    expect(result.current).toEqual(A)
  })

  it('snaps under prefers-reduced-motion', () => {
    setReducedMotion(true)
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    expect(result.current).toEqual(B)
  })

  it('follows the target immediately, cancelling a running ease, when not animating', () => {
    const { result, rerender } = render({ target: A })
    rerender({ target: B })
    frames(50)
    const manual = { x: 7, y: 8, scale: 2 }
    rerender({ target: manual, animate: false })
    expect(result.current).toEqual(manual)
    frames(EASE_MS * 2)
    expect(result.current).toEqual(manual)
  })

  it('snaps when the settle key changes, such as a resize', () => {
    const { result, rerender } = render({ target: A, settleKey: '800x600' })
    rerender({ target: B, settleKey: '1000x600' })
    expect(result.current).toEqual(B)
  })
})
