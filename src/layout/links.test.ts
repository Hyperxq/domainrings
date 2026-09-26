import { describe, expect, it } from 'vitest'
import { routeLink, type RouteEnd } from './links'
import type { Box, Point } from './layout'
import { hexagonBounds, layoutMap, type MapHexagonLayout } from './map'
import { freeCell } from '../model/map'
import type { HexaMap, Hexagon, Wall } from '../model/schema'

const COS30 = Math.sqrt(3) / 2

describe('routeLink — boxes separated on X (side by side), ports facing each other', () => {
  it('exits each port along its own wall, then crosses the gap’s midline: [portA, stubA, midA, midB, stubB, portB]', () => {
    const from: RouteEnd = { point: { x: 50, y: -10 }, wall: 'e', box: { x: -50, y: -50, width: 100, height: 100 } }
    const to: RouteEnd = { point: { x: 250, y: 20 }, wall: 'w', box: { x: 250, y: -50, width: 100, height: 100 } }

    const { points: path, label } = routeLink(from, to)

    expect(path).toEqual([
      { x: 50, y: -10 },
      { x: 65, y: -10 },
      { x: 150, y: -10 },
      { x: 150, y: 20 },
      { x: 235, y: 20 },
      { x: 250, y: 20 },
    ])
    // The midline sits strictly between the two boxes — outside both regardless of y (REQ-LNK-05.1).
    expect(path[2].x).toBeGreaterThan(from.box.x + from.box.width)
    expect(path[2].x).toBeLessThan(to.box.x)
    // The label sits halfway along the midline crossing, turned to run along the vertical gap, so its width
    // stays in the channel instead of spilling onto either box.
    expect(label).toEqual({ at: { x: 150, y: 5 }, vertical: true })
  })
})

describe('routeLink — boxes separated on Y (stacked), ports facing each other', () => {
  it('picks the Y midline when that is the axis the two boxes are actually apart on, no detour needed', () => {
    const from: RouteEnd = { point: { x: -30, y: -50 }, wall: 'se', box: { x: -50, y: -150, width: 100, height: 100 } }
    const to: RouteEnd = { point: { x: -20, y: 50 }, wall: 'ne', box: { x: -40, y: 50, width: 100, height: 100 } }

    const { points: path, label } = routeLink(from, to)

    expect(path).toHaveLength(6)
    expect(path[0]).toEqual(from.point)
    expect(path[5]).toEqual(to.point)
    // stub A: exits south-east from its port by GAP_MARGIN (15) along (0.5, COS30) — exitDistance is 0 since the
    // port already sits on the box's own bottom edge.
    expect(path[1].x).toBeCloseTo(-22.5, 6)
    expect(path[1].y).toBeCloseTo(-50 + 15 * COS30, 6)
    // Both midline points sit at y=0 (the gap's midline), keeping each stub's own x — no detour on either end.
    expect(path[2]).toEqual({ x: path[1].x, y: 0 })
    expect(path[3]).toEqual({ x: path[4].x, y: 0 })
    expect(path[4].x).toBeCloseTo(-12.5, 6)
    expect(path[4].y).toBeCloseTo(50 - 15 * COS30, 6)
    expect(label).toEqual({ at: { x: (path[2].x + path[3].x) / 2, y: 0 }, vertical: false })
  })
})

describe('routeLink — a port whose wall faces AWAY from the target detours around its own box (REQ-LNK-05.1)', () => {
  it('both ports facing away from each other (default walls, B west of A): the stub sweep alone would cross the box, so a corner detour is inserted', () => {
    // The reported failure shape: A's driven port defaults to wall 'e' (faces east) while B, the link target,
    // sits WEST of A — so A's own exit segment does not already face the gap, and the same is true for B's
    // driving port (default wall 'w', facing further west, away from A).
    const from: RouteEnd = { point: { x: 50, y: 0 }, wall: 'e', box: { x: -50, y: -50, width: 100, height: 100 } }
    const to: RouteEnd = { point: { x: -250, y: 0 }, wall: 'w', box: { x: -250, y: -50, width: 100, height: 100 } }

    const { points: path } = routeLink(from, to)

    // Every segment except the two exit-stub ones (index 0→1 and the last one) must clear BOTH boxes entirely.
    for (let i = 2; i < path.length - 2; i++) {
      expect(segmentPenetratesBox(path[i], path[i + 1], from.box)).toBe(false)
      expect(segmentPenetratesBox(path[i], path[i + 1], to.box)).toBe(false)
    }
    // The exit-stub segments must clear the OTHER box outright (only their OWN box gets the lighter treatment).
    expect(segmentPenetratesBox(path[0], path[1], to.box)).toBe(false)
    expect(segmentPenetratesBox(path[path.length - 2], path[path.length - 1], from.box)).toBe(false)

    // A detour was actually inserted on both ends (path longer than the facing case's 6 points).
    expect(path.length).toBeGreaterThan(6)
  })
})

/** `segmentPenetratesBox`/`clipToBox`: Liang-Barsky clip of `p1→p2` against `box`; true only for a clip range of
 * positive length (a real crossing, not a single touching point). Declared once, reused by every test below. */
function clipToBox(p1: Point, p2: Point, box: Box): [number, number] | null {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const edges: Array<[number, number]> = [
    [-dx, p1.x - box.x],
    [dx, box.x + box.width - p1.x],
    [-dy, p1.y - box.y],
    [dy, box.y + box.height - p1.y],
  ]
  let t0 = 0
  let t1 = 1
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return t0 <= t1 ? [t0, t1] : null
}

function segmentPenetratesBox(p1: Point, p2: Point, box: Box, epsilon = 1e-6): boolean {
  const clip = clipToBox(p1, p2, box)
  return clip !== null && clip[1] - clip[0] > epsilon
}

// --- Property: a routed link never crosses the body of either of its own two endpoint hexagons (REQ-LNK-05.1) ---

/** A small seeded LCG (mirrors layout/map.test.ts's own makeRng — same recipe, kept local since this file must
 * import only model/* and layout/layout, and duplicating one pure function is cheaper than a shared test util). */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const emptyHexagon = (id: string, cell: Hexagon['cell']): Hexagon => ({
  id,
  contextId: 'c1',
  cell,
  title: id,
  domain: [],
  useCases: [],
  ports: [],
  adapters: [],
  actors: [],
  externals: [],
})

/** N empty hexagons grown via `freeCell` (the same topology grow-the-map itself produces), two of them (by seed)
 * carrying one port each — a driven port on one, a driving port on the other, default walls — joined by a link. */
function seededLinkedMap(seed: number, n: number): HexaMap {
  const rng = makeRng(seed)
  const hexagons: Hexagon[] = []
  for (let i = 0; i < n; i++) {
    const cell = i === 0 ? { q: 0, r: 0 } : freeCell({ hexagons }, hexagons[Math.floor(rng() * hexagons.length)].cell)
    hexagons.push(emptyHexagon(`h${i + 1}`, cell))
  }
  const a = Math.floor(rng() * n)
  let b = Math.floor(rng() * n)
  while (b === a) b = Math.floor(rng() * n)
  hexagons[a] = { ...hexagons[a], ports: [{ id: 'p-from', name: 'from', side: 'driven' }] }
  hexagons[b] = { ...hexagons[b], ports: [{ id: 'p-to', name: 'to', side: 'driving' }] }
  return {
    version: 2,
    kind: 'hexagonal',
    title: `Seed ${seed}`,
    contexts: [{ id: 'c1' }],
    hexagons,
    links: [{ id: 'l1', from: { hexagonId: hexagons[a].id, portId: 'p-from' }, to: { hexagonId: hexagons[b].id, portId: 'p-to' } }],
  }
}

/** Two hexagons only — `h1` at {0,0} (driven port on `wallA`), `h2` at `bCell` (driving port on `wallB`) — lets
 * the "wall faces away" cases be built deterministically instead of hoping a random seed hits them. */
function facingPairMap(bCell: Hexagon['cell'], wallA: Wall, wallB: Wall): HexaMap {
  return {
    version: 2,
    kind: 'hexagonal',
    title: 'Facing pair',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { ...emptyHexagon('h1', { q: 0, r: 0 }), ports: [{ id: 'p-from', name: 'from', side: 'driven', wall: wallA }] },
      { ...emptyHexagon('h2', bCell), ports: [{ id: 'p-to', name: 'to', side: 'driving', wall: wallB }] },
    ],
    links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-from' }, to: { hexagonId: 'h2', portId: 'p-to' } }],
  }
}

/** `hexagon`'s own outer silhouette (its rendered outline, NOT its bounding box — the box is the layout's full
 * bounds and, on a slanted wall, is strictly larger than the hexagon body itself) as six map-space vertices, in
 * the same order `render/band.ts`'s `outline()` draws them. */
function hexagonVertices(hexagon: MapHexagonLayout): Point[] {
  const { halfWidth: w, straight: h, apex: a } = hexagon.model.rings[0]
  const local: Point[] = [
    { x: 0, y: -a },
    { x: w, y: -h },
    { x: w, y: h },
    { x: 0, y: a },
    { x: -w, y: h },
    { x: -w, y: -h },
  ]
  return local.map((p) => ({ x: p.x + hexagon.centre.x, y: p.y + hexagon.centre.y }))
}

/** Standard ray-casting point-in-polygon test. */
function pointInPolygon(p: Point, vertices: Point[]): boolean {
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i]
    const vj = vertices[j]
    const crosses = vi.y > p.y !== vj.y > p.y && p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x
    if (crosses) inside = !inside
  }
  return inside
}

/**
 * Whether the route penetrates either of its own two endpoint hexagons — checking EVERY segment against BOTH
 * boxes, with exactly one tolerated exception per end: the exit-stub segment (port → its first exit point) may
 * lie inside its OWN box's rectangle AND cross its own hexagon's rendered rings on the way out — a port's layout
 * node sits in the ADAPTERS ring (confirmed by inspection: `kind:'port'` nodes carry `layer:'adapters'`), genuinely
 * inset from the hexagon's outer silhouette, not merely offset by a small margin — so the segment's own MIDPOINT
 * legitimately stays inside the polygon for a normal, correctly-built stub; only its END (the stub point itself)
 * is required to have actually left the polygon, checked via point-in-polygon against the hexagon's six outer
 * vertices. Every other segment, including that SAME exit-stub segment against the OTHER box/polygon, gets the
 * full box check — a genuine bug (the old unbounded exemption) let that first segment sweep all the way to the
 * gap midline, potentially through the SECOND hexagon too; that is caught by the full box check below, not by
 * this polygon check, which exists only to pin that the stub construction itself is not degenerate (e.g. a
 * zero-distance "stub" that never left its own hexagon at all).
 */
function linkPenetratesOwnBoxes(points: Point[], fromHex: MapHexagonLayout, toHex: MapHexagonLayout): boolean {
  const boxA = hexagonBounds(fromHex)
  const boxB = hexagonBounds(toHex)
  const verticesA = hexagonVertices(fromHex)
  const verticesB = hexagonVertices(toHex)

  for (let i = 1; i < points.length; i++) {
    const [p1, p2] = [points[i - 1], points[i]]
    const isFirst = i === 1
    const isLast = i === points.length - 1

    if (isFirst) {
      if (pointInPolygon(p2, verticesA)) return true
    } else if (segmentPenetratesBox(p1, p2, boxA)) {
      return true
    }

    if (isLast) {
      if (pointInPolygon(p1, verticesB)) return true
    } else if (segmentPenetratesBox(p1, p2, boxB)) {
      return true
    }
  }
  return false
}

function checkLink(map: HexaMap): boolean {
  const result = layoutMap(map)
  const link = result.links[0]
  const fromHex = result.hexagons.find((h) => h.id === map.links[0].from.hexagonId)!
  const toHex = result.hexagons.find((h) => h.id === map.links[0].to.hexagonId)!
  return linkPenetratesOwnBoxes(link.points, fromHex, toHex)
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const SIZES = [2, 5, 12, 30]

describe('layoutMap — routed links never cross the body of either of their own two endpoint hexagons (REQ-LNK-05.1)', () => {
  for (const seed of SEEDS) {
    for (const n of SIZES) {
      it(`seed ${seed}, N=${n}: the routed link clears both its own endpoint boxes`, () => {
        expect(checkLink(seededLinkedMap(seed, n))).toBe(false)
      })
    }
  }
})

describe('layoutMap — REQ-LNK-05.1 holds when a port’s own wall faces away from the target hexagon', () => {
  // The exact shape the verify agent's probe reported: a driven port defaults to wall 'e', a driving port to
  // wall 'w' — so any link to a hexagon placed anywhere other than straight ahead of the port's own wall exits
  // facing away from it.
  const CELLS: Array<[string, Hexagon['cell']]> = [
    ['west of A', { q: -1, r: 0 }],
    ['north-west of A', { q: 0, r: -1 }],
    ['south-west of A', { q: -1, r: 1 }],
  ]
  const WALLS: Wall[] = ['e', 'ne', 'se']

  for (const [label, cell] of CELLS) {
    for (const wallA of WALLS) {
      it(`A's driven port on wall '${wallA}', B (driving, default wall 'w') ${label}`, () => {
        expect(checkLink(facingPairMap(cell, wallA, 'w'))).toBe(false)
      })
    }
  }

  it('reproduces the exact verify-agent probe: A driven/east at {0,0}, B driving/west at {-1,0}', () => {
    const map = facingPairMap({ q: -1, r: 0 }, 'e', 'w')
    const result = layoutMap(map)
    const link = result.links[0]
    const fromHex = result.hexagons.find((h) => h.id === 'h1')!
    const toHex = result.hexagons.find((h) => h.id === 'h2')!

    expect(linkPenetratesOwnBoxes(link.points, fromHex, toHex)).toBe(false)
    // A detour was actually needed (not just coincidentally safe) — more than the facing case's 4 raw points.
    expect(link.points.length).toBeGreaterThan(4)
  })
})

describe('layoutMap — a routed link is unaffected by a third, unrelated hexagon between its endpoints (REQ-LNK-05.2)', () => {
  it('produces the identical polyline whether or not an extra hexagon exists elsewhere on the map', () => {
    const withoutThird = seededLinkedMap(3, 6)
    const extraCell = freeCell(withoutThird, withoutThird.hexagons[0].cell)
    const withThird: HexaMap = { ...withoutThird, hexagons: [...withoutThird.hexagons, emptyHexagon('h-extra', extraCell)] }

    const before = layoutMap(withoutThird).links[0]
    const after = layoutMap(withThird).links[0]

    expect(after).toEqual(before)
  })
})
