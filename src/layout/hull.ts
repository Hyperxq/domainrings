import { neighbour, type Cell } from '../model/map'
import type { Wall } from '../model/schema'
import type { Point } from './geometry'

const WALLS: readonly Wall[] = ['ne', 'e', 'se', 'sw', 'w', 'nw']
const cellKey = (cell: Cell) => `${cell.q},${cell.r}`

/** Evenodd point-in-polygon (ray casting) over a set of loops treated as one region — mirrors the `fill-rule`
 * a context's loops are rendered with, so this is the geometric proof the rendered hull actually encloses (or
 * excludes) a point. */
export function pointInRegion(point: Point, loops: readonly Point[][]): boolean {
  let inside = false
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i]
      const b = loop[j]
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside
      }
    }
  }
  return inside
}

function convexHull(points: readonly Point[]): Point[] {
  const chain = (sorted: Point[]) => {
    const half: Point[] = []
    for (const p of sorted) {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], p) <= 0) half.pop()
      half.push(p)
    }
    return half.slice(0, -1)
  }
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  return [...chain(sorted), ...chain([...sorted].reverse())]
}

/** Whether two convex polygons overlap (separating-axis test over both sets of edge normals). */
function convexOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  const separated = (from: readonly Point[]) =>
    from.some((p, i) => {
      const q = from[(i + 1) % from.length]
      const [nx, ny] = [q.y - p.y, p.x - q.x]
      const range = (poly: readonly Point[]) => poly.map((v) => nx * v.x + ny * v.y)
      return Math.max(...range(a)) < Math.min(...range(b)) || Math.max(...range(b)) < Math.min(...range(a))
    })
  return !separated(a) && !separated(b)
}

const EPS = 1e-6
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const areaSign = (poly: readonly Point[]) => Math.sign(poly.reduce((sum, p, i) => sum + cross({ x: 0, y: 0 }, p, poly[(i + 1) % poly.length]), 0))

/** How far inside a convex polygon `p` is: negative outside, near zero on its boundary. */
function depth(poly: readonly Point[], sign: number, p: Point): number {
  return Math.min(...poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]
    return (sign * cross(a, b, p)) / Math.hypot(b.x - a.x, b.y - a.y)
  }))
}

/** Where along a→b the segment c→d crosses it, if it does (parallel edges never do). */
function crossing(a: Point, b: Point, c: Point, d: Point): number | undefined {
  const [rx, ry, sx, sy] = [b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y]
  const den = rx * sy - ry * sx
  if (Math.abs(den) < EPS) return undefined
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return t > EPS && t < 1 - EPS && u > -EPS && u < 1 + EPS ? t : undefined
}

/**
 * The outline of the union of convex polygons, as closed loops (an enclosed gap is a loop of its own, for an evenodd
 * fill). Each edge is cut where other polygons' edges cross it and only the pieces outside every other polygon
 * survive; an edge two polygons share is kept once, by the earlier. Every polygon is wound the same way, so the
 * surviving pieces chain end to end.
 */
function union(input: readonly Point[][]): Point[][] {
  const polys = input.map((poly) => (areaSign(poly) < 0 ? [...poly].reverse() : poly))
  const key = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
  const next = new Map<string, [Point, Point]>()
  polys.forEach((poly, i) =>
    poly.forEach((a, k) => {
      const b = poly[(k + 1) % poly.length]
      const cuts = [0, 1]
      polys.forEach((other, j) => other.forEach((c, m) => {
        const t = j === i ? undefined : crossing(a, b, c, other[(m + 1) % other.length])
        if (t !== undefined) cuts.push(t)
      }))
      cuts.sort((x, y) => x - y)
      for (let n = 1; n < cuts.length; n++) {
        const [from, to] = [lerp(a, b, cuts[n - 1]), lerp(a, b, cuts[n])]
        const mid = lerp(from, to, 0.5)
        const covered = polys.some((other, j) => {
          if (j === i) return false
          const d = depth(other, 1, mid)
          return d > EPS || (d >= -EPS && j < i)
        })
        if (!covered && cuts[n] - cuts[n - 1] > EPS) next.set(key(from), [from, to])
      }
    }),
  )
  const loops: Point[][] = []
  const done = new Set<string>()
  for (const start of next.keys()) {
    const loop: Point[] = []
    for (let at = start; !done.has(at) && next.has(at); at = key(next.get(at)![1])) {
      done.add(at)
      loop.push(next.get(at)![0])
    }
    if (loop.length > 2) loops.push(loop.filter((p, i) => Math.abs(cross(loop[(i + loop.length - 1) % loop.length], p, loop[(i + 1) % loop.length])) > EPS * 100))
  }
  return loops
}

/**
 * Per-context boundary loops hugging each hexagon's own convex `outline`. A context's outline is the union of its
 * members' outlines, plus the convex hull of each pair of lattice-adjacent members so a gap between neighbours
 * closes into a neck — unless that neck would reach another context's outline, which then stays apart.
 */
export function footprintRegions(hexagons: readonly { cell: Cell; contextId: string; outline: Point[] }[]): Map<string, Point[][]> {
  const result = new Map<string, Point[][]>()
  for (const contextId of new Set(hexagons.map((h) => h.contextId))) {
    const [own, foreign] = [hexagons.filter((h) => h.contextId === contextId), hexagons.filter((h) => h.contextId !== contextId)]
    const necks = own.flatMap((a, i) =>
      own.slice(i + 1).flatMap((b) => {
        const touching = WALLS.some((wall) => cellKey(neighbour(a.cell, wall)) === cellKey(b.cell))
        const neck = touching ? convexHull([...a.outline, ...b.outline]) : []
        return neck.length && !foreign.some((f) => convexOverlap(neck, f.outline)) ? [neck] : []
      }),
    )
    result.set(contextId, union([...own.map((h) => h.outline), ...necks]))
  }
  return result
}
