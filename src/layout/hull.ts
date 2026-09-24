import { neighbour, type Cell } from '../model/map'
import type { Wall } from '../model/schema'
import type { Point } from './layout'

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
  for (const h of hexagons) byContext.set(h.contextId, [...(byContext.get(h.contextId) ?? []), h.cell])

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
