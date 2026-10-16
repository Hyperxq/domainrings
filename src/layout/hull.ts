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

/** Whether `other`'s boundary at `mid` runs the way a→b does (same winding, so same side filled). Undefined when `mid` is not on it. */
function runsAlong(other: readonly Point[], mid: Point, a: Point, b: Point): boolean | undefined {
  const edge = other.find((c, m) => {
    const d = other[(m + 1) % other.length]
    return Math.abs(cross(c, d, mid)) / Math.hypot(d.x - c.x, d.y - c.y) < EPS
  })
  if (!edge) return undefined
  const end = other[(other.indexOf(edge) + 1) % other.length]
  return (end.x - edge.x) * (b.x - a.x) + (end.y - edge.y) * (b.y - a.y) > 0
}

/**
 * The outline of the union of convex polygons, as closed loops (an enclosed gap is a loop of its own, for an evenodd
 * fill). Each edge is cut where other polygons' edges cross it and only the pieces outside every other polygon
 * survive; an edge two polygons share is kept once, by the earlier, when they run the same way, and dropped by both
 * when they run opposite ways (the two shapes just touch). Every polygon is wound the same way, so the surviving
 * pieces chain end to end; where several leave one point the leftmost turn is taken, which keeps touching shapes
 * apart. Should a chain not close, the convex hull of everything stands in rather than a broken loop.
 */
function union(input: readonly Point[][]): Point[][] {
  const polys = input.map((poly) => (areaSign(poly) < 0 ? [...poly].reverse() : poly))
  const key = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
  const out = new Map<string, { from: Point; to: Point; used: boolean }[]>()
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
          if (d > EPS) return true
          return d >= -EPS && (j < i || !runsAlong(other, mid, a, b))
        })
        if (!covered && cuts[n] - cuts[n - 1] > EPS) out.set(key(from), [...(out.get(key(from)) ?? []), { from, to, used: false }])
      }
    }),
  )
  const loops: Point[][] = []
  for (const first of [...out.values()].flat()) {
    if (first.used) continue
    const loop: Point[] = []
    let closed = false
    for (let piece: typeof first | undefined = first; piece && !piece.used; ) {
      piece.used = true
      loop.push(piece.from)
      if ((closed = key(piece.to) === key(first.from))) break
      const heading = Math.atan2(piece.to.y - piece.from.y, piece.to.x - piece.from.x)
      const turn = (c: typeof first) => ((Math.atan2(c.to.y - c.from.y, c.to.x - c.from.x) - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
      piece = (out.get(key(piece.to)) ?? []).filter((c) => !c.used).sort((p, q) => turn(q) - turn(p)).at(0)
    }
    if (!closed) return [convexHull(polys.flat())]
    if (loop.length > 2) loops.push(loop.filter((p, n) => Math.abs(cross(loop[(n + loop.length - 1) % loop.length], p, loop[(n + 1) % loop.length])) > EPS * 100))
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
