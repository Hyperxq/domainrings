import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Viewport } from './viewport'

export const EASE_MS = 320
/** The longest ease: a far zoom gets more time than a short one, but never feels like a wait. */
const MAX_EASE_MS = 700

/** Starts and ends at rest: an ease-out would open every move with its fastest frame, which reads as a jolt. */
const easeInOut = (t: number) => (1 - Math.cos(Math.PI * t)) / 2
const same = (a: Viewport, b: Viewport) => a.x === b.x && a.y === b.y && a.scale === b.scale
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Scale interpolates log-linearly so a zoom reads as a constant-speed zoom, not one that rushes at the end. The
 * origin follows the one diagram point both views put at the same screen spot, so a zoom heads straight at it instead
 * of sliding sideways (a linear origin against a log scale swings the view). Equal scales have no such point: a pan. */
const between = (from: Viewport, to: Viewport, t: number): Viewport => {
  const scale = from.scale * (to.scale / from.scale) ** t
  if (from.scale === to.scale) return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, scale }
  const pivot = (a: number, b: number) => (b * to.scale - a * from.scale) / (to.scale - from.scale)
  const along = (a: number, b: number) => pivot(a, b) - ((pivot(a, b) - a) * from.scale) / scale
  return { x: along(from.x, to.x), y: along(from.y, to.y), scale }
}

/** On-screen travel that earns one more EASE_MS, so a long pan keeps a readable speed. */
const PAN_PX_PER_EASE = 600

/** One EASE_MS per doubling or halving of the scale, or per PAN_PX_PER_EASE of on-screen travel, whichever is longer;
 * never under one EASE_MS nor over MAX_EASE_MS. */
const durationOf = (from: Viewport, to: Viewport) => {
  const zoom = Math.abs(Math.log2(to.scale / from.scale))
  const pan = (Math.hypot(to.x - from.x, to.y - from.y) * Math.min(from.scale, to.scale)) / PAN_PX_PER_EASE
  return Math.min(MAX_EASE_MS, EASE_MS * Math.max(1, zoom, pan))
}

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
    const duration = durationOf(from, target)
    const step = (now: number) => {
      start ??= now
      const t = Math.min(1, (now - start) / duration)
      const next = t >= 1 ? target : between(from, target, easeInOut(t))
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
