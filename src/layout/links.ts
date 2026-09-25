import { wallFrame } from './layout'
import type { Box, Point } from './layout'
import type { Wall } from '../model/schema'

/** One end's routing inputs: the port's world-space point, its resolved wall, and its own hexagon's map-space
 * bounding box. */
export interface RouteEnd {
  point: Point
  wall: Wall
  box: Box
}

/** A quarter of `layout/map.ts`'s `MAP_GAP` (60) — a local constant, not an import: `layoutMap` calls
 * `routeLink`, so this module must not import back from `layout/map.ts`. Small enough that a stub or a detour
 * corner never travels more than `MAP_GAP/2` past its own box's edge — since two hexagon boxes are always at
 * least `MAP_GAP` apart (`layoutMap`'s own placement guarantee), a stub built from this margin can never reach
 * into the OTHER hexagon's box. */
const GAP_MARGIN = 15

/** `box`'s own edge on `axis` (`'x' | 'y'`) facing `side` (`'lo'` = its min edge, `'hi'` = its max edge). */
function edge(box: Box, axis: 'x' | 'y', side: 'lo' | 'hi'): number {
  return axis === 'x' ? (side === 'lo' ? box.x : box.x + box.width) : side === 'lo' ? box.y : box.y + box.height
}

function otherAxis(axis: 'x' | 'y'): 'x' | 'y' {
  return axis === 'x' ? 'y' : 'x'
}

/** How far, from `p0`, a ray with velocity `d` travels before leaving `[lo, hi]` — `Infinity` when `d` never
 * carries it out (parallel to that axis). */
function axisExit(p0: number, d: number, lo: number, hi: number): number {
  if (d === 0) return Infinity
  return d > 0 ? (hi - p0) / d : (lo - p0) / d
}

/** How far the ray `p + t·dir` (t ≥ 0) travels before leaving `box` — the smaller of the two axes' own exits,
 * since the ray has already left the box the instant either axis' range is exceeded. Assumes `p` starts inside
 * (or on) `box`, which every port does. */
function exitDistance(p: Point, dir: Point, box: Box): number {
  return Math.min(axisExit(p.x, dir.x, box.x, box.x + box.width), axisExit(p.y, dir.y, box.y, box.y + box.height))
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

/** Whether sweeping `mid.axis` from `from` to `to`, at the fixed `other` coordinate on the OTHER axis, would
 * cross `box` — true only when `other` sits strictly inside the box's range on the other axis AND the swept
 * range overlaps the box's range on `mid.axis`. Every segment this module builds is axis-aligned (only one of a
 * point's two coordinates ever changes along it), so this replaces a general segment/box clip. */
function sweepCrossesBox(mid: { axis: 'x' | 'y'; at: number }, other: number, from: number, to: number, box: Box): boolean {
  const oAxis = otherAxis(mid.axis)
  if (!(other > edge(box, oAxis, 'lo') && other < edge(box, oAxis, 'hi'))) return false
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  return hi > edge(box, mid.axis, 'lo') && lo < edge(box, mid.axis, 'hi')
}

/**
 * One end's exit points, from its port up to (but not including) the gap-midline crossing: `[stub]`, or
 * `[stub, corner]` when the port's wall faces away from the gap and a straight stub→midline sweep would cut
 * back across the port's own hexagon.
 *
 * `stub` stands the port off along its wall's own outward normal (`wallFrame`, the SAME six unit vectors
 * `layout/layout.ts` places ports and sockets with) by `GAP_MARGIN` beyond where that ray leaves the port's own
 * box — clearing the box regardless of which wall the port is on (a slanted wall's port can sit well inside the
 * box's RECTANGLE, since the box is the layout's full bounds and the hexagon's actual silhouette cuts the
 * rectangle's corners).
 *
 * When the wall faces roughly toward the gap, sweeping `stub` straight onto the gap's midline (keeping the
 * OTHER axis fixed at `stub`'s own value) never re-enters the box — `stub` already cleared it, and the sweep
 * only moves further along the gap axis. When the wall faces AWAY (the target lies behind it), that same sweep
 * would traverse the full width of the box at `stub`'s (still-interior) other-axis coordinate. `corner` escapes
 * first: same gap-axis coordinate as `stub` (no change yet), other axis pushed `GAP_MARGIN` past whichever of
 * the box's two other-axis edges `stub` sits closer to — which clears the box on the OTHER axis, so every
 * remaining leg (stub→corner, a pure other-axis move at a fixed, already-outside gap-axis coordinate; then
 * corner→midline, a pure gap-axis sweep at a fixed, already-outside other-axis coordinate) stays clear of it
 * regardless of the other coordinate.
 */
function exitPoints(end: RouteEnd, mid: { axis: 'x' | 'y'; at: number }): Point[] {
  const normal = wallFrame(end.wall).n
  const distance = exitDistance(end.point, normal, end.box) + GAP_MARGIN
  const stub: Point = { x: end.point.x + normal.x * distance, y: end.point.y + normal.y * distance }

  const other = mid.axis === 'x' ? stub.y : stub.x
  const stubGap = mid.axis === 'x' ? stub.x : stub.y
  if (!sweepCrossesBox(mid, other, stubGap, mid.at, end.box)) return [stub]

  const oAxis = otherAxis(mid.axis)
  const loEdge = edge(end.box, oAxis, 'lo')
  const hiEdge = edge(end.box, oAxis, 'hi')
  const cornerOther = other - loEdge <= hiEdge - other ? loEdge - GAP_MARGIN : hiEdge + GAP_MARGIN
  const corner: Point = mid.axis === 'x' ? { x: stub.x, y: cornerOther } : { x: cornerOther, y: stub.y }
  return [stub, corner]
}

/** Drops a point that repeats the one before it — the two exit-point lists can independently land on the same
 * gap-midline crossing (e.g. a symmetric detour on both ends), which would otherwise leave a zero-length segment. */
function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
}

/**
 * Deterministic channel route between two ports (ADR-01, refined) — a pure function of the two endpoints; it
 * never inspects any hexagon but the two endpoints, so it is O(1) per link regardless of map size
 * (REQ-LNK-05.2). Crosses via the midline of the gap the two hexagons' own boxes are guaranteed to have between
 * them (`layout/map.ts` never places two boxes closer than `MAP_GAP`), reached from each port via `exitPoints` —
 * a bounded exit stub, plus a corner detour when the port's own wall faces away from the gap — so the guarantee
 * holds regardless of which wall either port sits on (REQ-LNK-05.1).
 */
export function routeLink(from: RouteEnd, to: RouteEnd): Point[] {
  const mid = gapMidline(from.box, to.box)
  const fromExit = exitPoints(from, mid)
  const toExit = exitPoints(to, mid)
  const fromLast = fromExit[fromExit.length - 1]
  const toLast = toExit[toExit.length - 1]

  return dedupe([from.point, ...fromExit, onMidline(fromLast, mid), onMidline(toLast, mid), ...[...toExit].reverse(), to.point])
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
