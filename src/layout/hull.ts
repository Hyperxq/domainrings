import { neighbour, type Cell } from '../model/map'
import type { Wall } from '../model/schema'
import type { Point } from './geometry'

/**
 * The 6 tile vertices, clockwise from the top, as (dx, dy) offsets from a cell's own lattice coordinate. Scaling
 * `cellCentre`'s `{x: pitch.x·(q+r/2), y: pitch.y·r}` by (2/pitch.x, 3/pitch.y) turns both a cell's centre and
 * every tile vertex into an INTEGER lattice point — `{x: 2q+r+dx, y: 3r+dy}` — so two cells' shared vertex lands
 * on the exact same point (computed once from that integer key, never re-derived per cell) however pitch is
 * skewed, with no epsilon-matching needed.
 */
const TILE_VERTEX: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: -2 }, // top
  { dx: 1, dy: -1 }, // upper-right
  { dx: 1, dy: 1 }, // lower-right
  { dx: 0, dy: 2 }, // bottom
  { dx: -1, dy: 1 }, // lower-left
  { dx: -1, dy: -1 }, // upper-left
]
/** The wall crossed by the edge running from vertex i to vertex (i+1)%6 (matches `NEIGHBOUR_DELTA`'s skew). */
const EDGE_WALL: readonly Wall[] = ['ne', 'e', 'se', 'sw', 'w', 'nw']

const latticeKey = (cell: Cell, v: { dx: number; dy: number }) => `${2 * cell.q + cell.r + v.dx},${3 * cell.r + v.dy}`
const cellKey = (cell: Cell) => `${cell.q},${cell.r}`

/**
 * Per-context boundary loops (ADR-04): the union of a context's cells' lattice tiles, traced as closed polylines.
 * A context whose cells are not all adjacent draws as several outer loops (a split context, CB-02.1); a context
 * whose cells ring another context's cell gets a hole loop around it (CB-02.2) — an evenodd fill draws that hole
 * transparent.
 */
export function contextRegions(hexagons: readonly { cell: Cell; contextId: string }[], pitch: Point): Map<string, Point[][]> {
  const contextByCell = new Map(hexagons.map((h) => [cellKey(h.cell), h.contextId]))
  const byContext = new Map<string, Cell[]>()
  for (const h of hexagons) {
    const cells = byContext.get(h.contextId)
    if (cells) cells.push(h.cell)
    else byContext.set(h.contextId, [h.cell])
  }

  const pointOf = (key: string): Point => {
    const [x, y] = key.split(',').map(Number)
    return { x: (x * pitch.x) / 2, y: (y * pitch.y) / 3 }
  }

  const result = new Map<string, Point[][]>()
  for (const [contextId, cells] of byContext) {
    // Directed boundary edges: kept only where the neighbour across that wall is NOT this context (empty cell or
    // a different one) — an edge shared by two same-context tiles is walked by both and cancels, leaving only
    // the union's true outer/hole boundary. Consistent per-cell winding (always vertex i -> i+1) means the
    // surviving edges chain into closed, non-self-crossing loops without needing a separate hole/outer test —
    // evenodd fill draws the right thing regardless of each loop's winding direction.
    const next = new Map<string, string>()
    for (const cell of cells) {
      for (let i = 0; i < 6; i++) {
        const neighbourCell = neighbour(cell, EDGE_WALL[i])
        if (contextByCell.get(cellKey(neighbourCell)) === contextId) continue
        next.set(latticeKey(cell, TILE_VERTEX[i]), latticeKey(cell, TILE_VERTEX[(i + 1) % 6]))
      }
    }
    const loops: Point[][] = []
    const visited = new Set<string>()
    for (const start of next.keys()) {
      if (visited.has(start)) continue
      const loop: Point[] = []
      let at = start
      do {
        visited.add(at)
        loop.push(pointOf(at))
        at = next.get(at)!
      } while (at !== start)
      loops.push(loop)
    }
    result.set(contextId, loops)
  }
  return result
}

/** Evenodd point-in-polygon (ray casting) over a set of loops treated as one region — mirrors the `fill-rule`
 * `contextRegions`' loops are rendered with, so this is the geometric proof the rendered hull actually encloses
 * (or excludes) a point. */
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
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
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

/** `items` grouped into runs of lattice-adjacent cells. */
function adjacentGroups<T extends { cell: Cell }>(items: readonly T[]): T[][] {
  let groups: T[][] = []
  for (const item of items) {
    const touching = groups.filter((group) => group.some((m) => EDGE_WALL.some((wall) => cellKey(neighbour(m.cell, wall)) === cellKey(item.cell))))
    groups = [...groups.filter((group) => !touching.includes(group)), [item, ...touching.flat()]]
  }
  return groups
}

/**
 * Per-context boundary loops hugging each hexagon's own `outline` rather than its lattice tile, for a map whose
 * hexagons no longer sit on the lattice. A run of adjacent same-context hexagons shares one convex loop, unless
 * that loop would reach another context's hexagon — then each keeps its own; outlines of different hexagons
 * never overlap, so the loops never punch holes in each other under an evenodd fill.
 */
export function footprintRegions(hexagons: readonly { cell: Cell; contextId: string; outline: Point[] }[]): Map<string, Point[][]> {
  const result = new Map<string, Point[][]>()
  for (const contextId of new Set(hexagons.map((h) => h.contextId))) {
    const foreign = hexagons.filter((h) => h.contextId !== contextId)
    const loops = adjacentGroups(hexagons.filter((h) => h.contextId === contextId)).flatMap((group) => {
      const hull = convexHull(group.flatMap((h) => h.outline))
      const reachesForeign = foreign.some((f) => convexOverlap(hull, convexHull(f.outline)))
      return reachesForeign ? group.map((h) => convexHull(h.outline)) : [hull]
    })
    result.set(contextId, loops)
  }
  return result
}
