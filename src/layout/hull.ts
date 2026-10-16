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

/** The most tiles `honeycombRegions` lays over the footprints; bounds the memory a huge hexagon can cost. */
const MAX_TILES = 200_000

/** Opposite walls: a tile with the same context on both is a gap one tile wide. */
const OPPOSITE: readonly (readonly [Wall, Wall])[] = [['e', 'w'], ['ne', 'sw'], ['nw', 'se']]

/** How far `p` lies outside a convex clockwise (on screen) polygon; negative inside, where it is only a depth. */
function outside(p: Point, polygon: readonly Point[]): number {
  const edges = polygon.map((a, i) => ({ a, b: polygon[(i + 1) % polygon.length] }))
  const depth = Math.max(...edges.map(({ a, b }) => ((b.y - a.y) * (p.x - a.x) - (b.x - a.x) * (p.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y)))
  if (depth <= 0) return depth
  return Math.min(
    ...edges.map(({ a, b }) => {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)))
      return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y))
    }),
  )
}

/**
 * Per-context honeycomb contours around footprints that no longer sit on the lattice: a pointy-top tile of the given
 * circumradius `tile` belongs to the context whose footprint its centre lies within one radius of, the nearest when two
 * contexts claim it, so every footprint is wholly covered and the outline stands off it by up to two radii. Tiles
 * left between two claimed tiles of one context are filled, so neighbouring footprints of a context share one loop.
 * The tiles grow when the footprints are so large that tracing them at `tile` would take more than `MAX_TILES`.
 */
export function honeycombRegions(footprints: readonly { contextId: string; footprint: readonly Point[] }[], tile: number): Map<string, Point[][]> {
  const area = footprints.reduce((sum, { footprint }) => sum + (Math.max(...footprint.map((p) => p.x)) - Math.min(...footprint.map((p) => p.x))) * (Math.max(...footprint.map((p) => p.y)) - Math.min(...footprint.map((p) => p.y))), 0)
  const radius = Math.max(tile, Math.sqrt(area / (MAX_TILES * 1.5 * Math.sqrt(3))))
  const pitch = { x: Math.sqrt(3) * radius, y: 1.5 * radius }
  const claimed = new Map<string, { cell: Cell; contextId: string; distance: number }>()
  for (const { contextId, footprint } of footprints) {
    const [xs, ys] = [footprint.map((p) => p.x), footprint.map((p) => p.y)]
    for (let r = Math.floor((Math.min(...ys) - radius) / pitch.y); r <= Math.ceil((Math.max(...ys) + radius) / pitch.y); r++) {
      for (let q = Math.floor((Math.min(...xs) - radius) / pitch.x - r / 2); q <= Math.ceil((Math.max(...xs) + radius) / pitch.x - r / 2); q++) {
        const distance = outside({ x: pitch.x * (q + r / 2), y: pitch.y * r }, footprint)
        const key = cellKey({ q, r })
        if (distance <= radius && distance < (claimed.get(key)?.distance ?? Infinity)) claimed.set(key, { cell: { q, r }, contextId, distance })
      }
    }
  }
  const owner = (cell: Cell) => claimed.get(cellKey(cell))?.contextId
  const gaps = [...claimed.values()].flatMap(({ cell }) => EDGE_WALL.map((wall) => neighbour(cell, wall))).filter((cell) => !claimed.has(cellKey(cell)))
  const filled = new Map<string, { cell: Cell; contextId: string }>()
  for (const cell of gaps) {
    for (const [a, b] of OPPOSITE) {
      const contextId = owner(neighbour(cell, a))
      if (contextId && contextId === owner(neighbour(cell, b)) && !filled.has(cellKey(cell))) filled.set(cellKey(cell), { cell, contextId })
    }
  }
  return contextRegions([...claimed.values(), ...filled.values()], pitch)
}
