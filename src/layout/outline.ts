export const SQRT3 = Math.sqrt(3)
export const COS30 = SQRT3 / 2
const MIN_BAND = 36

export interface Outline {
  halfWidth: number
  straight: number
  apex: number
}

export interface Need {
  x: number
  y: number
}

export function halfWidthAt(o: Outline, dy: number): number {
  const a = Math.abs(dy)
  return a <= o.straight ? o.halfWidth : Math.max(0, o.halfWidth - (a - o.straight) * SQRT3)
}

/** Distance from the centre line to the ring's top edge at horizontal offset x (0 outside the ring). */
export function topAt(o: Outline, x: number): number {
  const a = Math.abs(x)
  if (a >= o.halfWidth) return o.straight
  return o.straight + (o.halfWidth - a) / SQRT3
}

/** Depth below the apex from which the ring is at least 2·half wide. */
export function depthAt(o: Outline, half: number): number {
  return Math.min(half / SQRT3, o.apex - o.straight)
}

export const circle = (r: number): Outline => ({ halfWidth: r, straight: 0, apex: r })
export const hexagon = (r: number): Outline => ({ halfWidth: r * COS30, straight: r / 2, apex: r })

/**
 * Smallest ring around `inner` holding every need. A regular hexagon's half-width at dy is
 * min(r·cos30, (r − |dy|)·√3), so a point (x, y) needs r >= x/cos30 and r >= y + x/√3. `side` needs
 * must also land on the straight vertical side (|dy| <= r/2), where ports and adapters line up.
 */
export function fitRing(inner: Outline, side: Need[], vertical: Need[], minApothem = 0): Outline {
  const needs = [...side, ...vertical]
  return hexagon(
    Math.max(
      minApothem / COS30,
      inner.apex + MIN_BAND / COS30,
      ...needs.map((n) => Math.max(n.x / COS30, n.y + n.x / SQRT3)),
      ...side.map((n) => 2 * n.y),
    ),
  )
}
