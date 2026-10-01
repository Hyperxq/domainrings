import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Viewport } from './viewport'

export const EASE_MS = 250

const easeOut = (t: number) => 1 - (1 - t) ** 3
const same = (a: Viewport, b: Viewport) => a.x === b.x && a.y === b.y && a.scale === b.scale
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Scale interpolates log-linearly so a zoom reads as a constant-speed zoom, not one that rushes at the end. */
const between = (from: Viewport, to: Viewport, t: number): Viewport => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
  scale: from.scale * (to.scale / from.scale) ** t,
})

/** The viewport to draw: eases from the view on screen to `target` whenever the target moves, unless `animate` is
 * off (a manual pan or zoom must track the pointer) or the user prefers reduced motion. A change of `settleKey`
 * (the stage's size) snaps, since a resize is not a fit the user should watch. Drawing only; exports read the
 * model's own bounds, never this value. `heading` is where the view is going as of the last committed render: during
 * the render a new target arrives it still holds the previous destination, which is what a caller freezing the view
 * at that moment wants rather than a frame partway there. */
export function useEasedViewport(target: Viewport, animate: boolean, settleKey = ''): { viewport: Viewport; heading: RefObject<Viewport> } {
  const [shown, setShown] = useState(target)
  // What is actually on screen, kept current while a tween runs so a retarget starts from it.
  const onScreen = useRef(target)
  const heading = useRef(target)
  const seenSettleKey = useRef(settleKey)

  // Layout effect: a snap must land before paint, or the stale `shown` would flash for a frame.
  useLayoutEffect(() => {
    const settled = seenSettleKey.current !== settleKey
    seenSettleKey.current = settleKey
    heading.current = target
    if (!animate) {
      onScreen.current = target
      return
    }
    const from = onScreen.current
    if (settled || same(from, target) || reducedMotion()) {
      onScreen.current = target
      setShown(target)
      return
    }
    setShown(from)
    let frame = 0
    let start: number | null = null
    const step = (now: number) => {
      start ??= now
      const t = Math.min(1, (now - start) / EASE_MS)
      const next = t >= 1 ? target : between(from, target, easeOut(t))
      onScreen.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // The target's fields, not its identity: a fresh object with the same numbers must not restart the ease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.scale, animate, settleKey])

  return { viewport: animate ? shown : target, heading }
}
