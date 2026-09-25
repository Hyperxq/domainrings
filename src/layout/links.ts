import type { Box, Point } from './layout'

/** One end's routing inputs: the port's world-space point and its own hexagon's map-space bounding box. */
export interface RouteEnd {
  point: Point
  box: Box
}

/** `box`'s own edge on `axis` (`'x' | 'y'`) facing `side` (`'lo'` = its min edge, `'hi'` = its max edge). */
function edge(box: Box, axis: 'x' | 'y', side: 'lo' | 'hi'): number {
  return axis === 'x' ? (side === 'lo' ? box.x : box.x + box.width) : side === 'lo' ? box.y : box.y + box.height
}

/**
 * The midline of the gap between two boxes that never overlap (`layout/map.ts` guarantees at least `MAP_GAP`
 * separation between every pair of hexagon boxes it places). Two disjoint axis-aligned boxes are always
 * separated on at least one axis (else they would overlap on both and coincide); that midline sits strictly
 * outside BOTH boxes' range on that axis, regardless of the other — a line drawn along it, at any two points on
 * the other axis, never enters either box. When both axes have a gap, X is preferred (a tie only when one box
 * sits diagonally from the other; either choice routes correctly).
 */
function gapMidline(boxA: Box, boxB: Box): { axis: 'x' | 'y'; at: number } {
  const gapX = edge(boxA, 'x', 'hi') <= edge(boxB, 'x', 'lo') || edge(boxB, 'x', 'hi') <= edge(boxA, 'x', 'lo')
  const axis: 'x' | 'y' = gapX ? 'x' : 'y'
  const [lo, hi] = edge(boxA, axis, 'hi') <= edge(boxB, axis, 'lo') ? [boxA, boxB] : [boxB, boxA]
  return { axis, at: (edge(lo, axis, 'hi') + edge(hi, axis, 'lo')) / 2 }
}

/** `p` projected onto the gap's midline — same coordinate on the OTHER axis, `mid.at` on the gap's own axis. */
function onMidline(p: Point, mid: { axis: 'x' | 'y'; at: number }): Point {
  return mid.axis === 'x' ? { x: mid.at, y: p.y } : { x: p.x, y: mid.at }
}

/**
 * Deterministic channel route between two ports (ADR-01, refined) — a pure function of the two endpoints; it
 * never inspects any hexagon but the two endpoints, so it is O(1) per link regardless of map size
 * (REQ-LNK-05.2). The path always crosses via the midline of the gap the two hexagons' own boxes are guaranteed
 * to have between them (`layout/map.ts` never places two boxes closer than `MAP_GAP`): the first and last
 * segments make the one unavoidable crossing of their OWN hexagon a port always starts inside of — a port's
 * layout node can sit anywhere on its hexagon's actual (hexagonal, not rectangular) silhouette, well inside the
 * box's rectangle on a slanted wall — and the segment BETWEEN them runs along the gap's own midline, strictly
 * outside both boxes by construction, for REQ-LNK-05.1's guarantee to hold regardless of which walls the two
 * ports sit on.
 */
export function routeLink(from: RouteEnd, to: RouteEnd): Point[] {
  const mid = gapMidline(from.box, to.box)
  return [from.point, onMidline(from.point, mid), onMidline(to.point, mid), to.point]
}

/** The point at half the polyline's total length — the pattern label's anchor (REQ-LNK-06.1). */
export function arcLengthMidpoint(points: Point[]): Point {
  const segments: Array<{ from: Point; to: Point; length: number }> = []
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    segments.push({ from, to, length: Math.hypot(to.x - from.x, to.y - from.y) })
  }
  const total = segments.reduce((sum, s) => sum + s.length, 0)
  let remaining = total / 2
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const t = segment.length === 0 ? 0 : remaining / segment.length
      return { x: segment.from.x + (segment.to.x - segment.from.x) * t, y: segment.from.y + (segment.to.y - segment.from.y) * t }
    }
    remaining -= segment.length
  }
  return points[points.length - 1]
}
