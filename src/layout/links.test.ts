import { describe, expect, it } from 'vitest'
import { routeLink, type RouteEnd } from './links'
import { wallFrame, type Box, type NodeKind, type Point } from './layout'
import { layoutMap, type MapHexagonLayout } from './map'
import { freeCell } from '../model/map'
import type { HexaMap, Hexagon, Wall } from '../model/schema'

/** The node kinds REQ-LNK-05.1 names, mirrored from `layout/map.ts`'s own (private) `AVOIDED_KINDS` — duplicating
 * one small set is cheaper than exporting a map.ts-internal constant just for this test file. */
const AVOIDED_KINDS: ReadonlySet<NodeKind> = new Set(['port', 'adapter', 'actor', 'external', 'useCase', 'domainItem'])

describe('routeLink — boxes separated on X (side by side), ports facing each other', () => {
  it('exits each port along its own wall, then crosses the gap’s midline: [portA, stubA, midA, midB, stubB, portB]', () => {
    const from: RouteEnd = { point: { x: 50, y: -10 }, wall: 'e', box: { x: -50, y: -50, width: 100, height: 100 }, clear: [] }
    const to: RouteEnd = { point: { x: 250, y: 20 }, wall: 'w', box: { x: 250, y: -50, width: 100, height: 100 }, clear: [] }

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
  it('picks the Y midline when that is the axis the two boxes are actually apart on, no detour needed (REQ-LNK-05.4: axis-aligned, no diagonal stub)', () => {
    // Both walls ('se'/'ne') are y-dominant (COS30 > 0.5), so the escape walk moves ONLY along y, keeping each
    // port's own x fixed — unlike the old diagonal wall-normal stub this rewrites (REQ-LNK-05.4).
    const from: RouteEnd = { point: { x: -30, y: -50 }, wall: 'se', box: { x: -50, y: -150, width: 100, height: 100 }, clear: [] }
    const to: RouteEnd = { point: { x: -20, y: 50 }, wall: 'ne', box: { x: -40, y: 50, width: 100, height: 100 }, clear: [] }

    const { points: path, label } = routeLink(from, to)

    expect(path).toHaveLength(6)
    expect(path[0]).toEqual(from.point)
    expect(path[5]).toEqual(to.point)
    // stub A: escapes along y only (the port already sits on the box's own bottom edge, y=-50) by GAP_MARGIN (15);
    // x stays at the port's own -30 — a pure vertical segment, not a diagonal one.
    expect(path[1]).toEqual({ x: -30, y: -35 })
    // Both midline points sit at y=0 (the gap's midline), keeping each stub's own x — no detour on either end.
    expect(path[2]).toEqual({ x: -30, y: 0 })
    expect(path[3]).toEqual({ x: -20, y: 0 })
    expect(path[4]).toEqual({ x: -20, y: 35 })
    expect(label).toEqual({ at: { x: -25, y: 0 }, vertical: false })
  })
})

describe('routeLink — a port whose wall faces AWAY from the target detours around its own box (REQ-LNK-05.1)', () => {
  it('both ports facing away from each other (default walls, B west of A): the stub sweep alone would cross the box, so a corner detour is inserted', () => {
    // The reported failure shape: A's driven port defaults to wall 'e' (faces east) while B, the link target,
    // sits WEST of A — so A's own exit segment does not already face the gap, and the same is true for B's
    // driving port (default wall 'w', facing further west, away from A).
    const from: RouteEnd = { point: { x: 50, y: 0 }, wall: 'e', box: { x: -50, y: -50, width: 100, height: 100 }, clear: [] }
    const to: RouteEnd = { point: { x: -250, y: 0 }, wall: 'w', box: { x: -250, y: -50, width: 100, height: 100 }, clear: [] }

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

/** `hexagon`'s own AVOIDED_KINDS sibling node boxes, in map space, excluding the node the link's own end anchors
 * on (`anchorRef` — the adapter's id when the end carries one, else the port's) — what REQ-LNK-05.1 forbids a
 * routed link from crossing, other than that one node. Spec V2 dropped the older whole-hexagon guarantee ("the
 * surrounding infrastructure ring" no requirement any more — an adapter sits INSIDE that ring, so any link must
 * cross the ring outline to leave its hexagon at all): the guarantee is about NODES, not the hexagon's own
 * silhouette or bounding rectangle. */
function siblingNodeBoxes(hexagon: MapHexagonLayout, anchorRef: string): Box[] {
  return hexagon.model.nodes
    .filter((n) => AVOIDED_KINDS.has(n.kind) && n.ref !== anchorRef)
    .map((n) => ({ x: n.x - n.width / 2 + hexagon.centre.x, y: n.y - n.height / 2 + hexagon.centre.y, width: n.width, height: n.height }))
}

/** Whether the route crosses a node box (port, adapter, actor, external, use case, domain item) of either of its
 * own two endpoint hexagons, other than the node each end anchors on (REQ-LNK-05.1, V2 wording) — every segment
 * checked against every sibling box, no exemption. */
function linkPenetratesOwnBoxes(points: Point[], fromHex: MapHexagonLayout, fromAnchorRef: string, toHex: MapHexagonLayout, toAnchorRef: string): boolean {
  const siblingsA = siblingNodeBoxes(fromHex, fromAnchorRef)
  const siblingsB = siblingNodeBoxes(toHex, toAnchorRef)

  for (let i = 1; i < points.length; i++) {
    const [p1, p2] = [points[i - 1], points[i]]
    if (siblingsA.some((box) => segmentPenetratesBox(p1, p2, box))) return true
    if (siblingsB.some((box) => segmentPenetratesBox(p1, p2, box))) return true
  }
  return false
}

function checkLink(map: HexaMap): boolean {
  const result = layoutMap(map)
  const link = result.links[0]
  const [linkFrom, linkTo] = [map.links[0].from, map.links[0].to]
  const fromHex = result.hexagons.find((h) => h.id === linkFrom.hexagonId)!
  const toHex = result.hexagons.find((h) => h.id === linkTo.hexagonId)!
  return linkPenetratesOwnBoxes(link.points, fromHex, linkFrom.adapterId ?? linkFrom.portId, toHex, linkTo.adapterId ?? linkTo.portId)
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

describe('layoutMap — every segment of a routed link is strictly horizontal or vertical (REQ-LNK-05.4)', () => {
  for (const seed of SEEDS) {
    for (const n of SIZES) {
      it(`seed ${seed}, N=${n}: the routed link has no diagonal segment`, () => {
        const { points } = layoutMap(seededLinkedMap(seed, n)).links[0]
        for (let i = 1; i < points.length; i++) {
          expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true)
        }
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

    expect(linkPenetratesOwnBoxes(link.points, fromHex, 'p-from', toHex, 'p-to')).toBe(false)
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

  /** `seededLinkedMap`, but both ends carry an adapter (REQ-LNK-05.3) plus one extra sibling leaf each, so `clear`
   * is non-empty on both ends — the bare-port case above never exercises `clear` at all. */
  function seededLinkedMapWithClear(seed: number, n: number): HexaMap {
    const base = seededLinkedMap(seed, n)
    const { from, to } = base.links[0]
    const withAdapter = (hexagon: Hexagon, portId: string, adapterId: string): Hexagon => {
      const side = hexagon.ports.find((p) => p.id === portId)!.side
      const leaf = { id: `${adapterId}-leaf`, name: 'Leaf', adapterId }
      return { ...hexagon, adapters: [{ id: adapterId, name: 'Adapter', portId }], ...(side === 'driving' ? { actors: [leaf] } : { externals: [leaf] }) }
    }
    const hexagons = base.hexagons.map((h) => {
      if (h.id === from.hexagonId) return withAdapter(h, from.portId, 'a-from')
      if (h.id === to.hexagonId) return withAdapter(h, to.portId, 'a-to')
      return h
    })
    return { ...base, hexagons, links: [{ ...base.links[0], from: { ...from, adapterId: 'a-from' }, to: { ...to, adapterId: 'a-to' } }] }
  }

  it('produces the identical polyline whether or not an extra hexagon exists, when both ends carry an adapter + sibling leaf (non-empty clear)', () => {
    const withoutThird = seededLinkedMapWithClear(3, 6)
    const extraCell = freeCell(withoutThird, withoutThird.hexagons[0].cell)
    const withThird: HexaMap = { ...withoutThird, hexagons: [...withoutThird.hexagons, emptyHexagon('h-extra', extraCell)] }

    const before = layoutMap(withoutThird).links[0]
    const after = layoutMap(withThird).links[0]

    expect(after).toEqual(before)
  })
})

/** Mirrors `links.ts`'s own (private) `escapeAxis` — duplicated here (not exported) so the fixture below can place
 * an obstacle precisely inside the escape walk's own coordinate frame, on both axes, without depending on where
 * the real layout engine happens to place a node's siblings. */
function escapeAxis(wall: Wall): { axis: 'x' | 'y'; dir: 1 | -1 } {
  const { n } = wallFrame(wall)
  const axis: 'x' | 'y' = Math.abs(n.x) >= Math.abs(n.y) ? 'x' : 'y'
  const dir = (axis === 'x' ? Math.sign(n.x) : Math.sign(n.y)) as 1 | -1
  return { axis, dir }
}

/**
 * A `from` RouteEnd anchored on `wall`, 30 units inside a generic hexagon box on the escape axis, with (or
 * without) a small sibling obstacle straddling the escape line 20–25 units out — inside the box, past
 * `GAP_MARGIN` (15), so avoiding it requires the walk to genuinely ADVANCE forward first, then jog (never a jog
 * fired in place at the anchor's own position, which would prove nothing about the advance-then-jog ordering).
 * Built from `escapeAxis` alone, so it exercises both the x-dominant (straight-wall) and y-dominant (slanted-wall)
 * branches of the same obstacle loop identically — the y-dominant branch is exactly what the real layout engine's
 * own adapter/leaf placement (app ring vs. outer ring, far apart) never happens to trigger (REQ-LNK-05.1).
 */
function obstacleFixture(wall: Wall, withObstacle: boolean): RouteEnd {
  const { axis, dir } = escapeAxis(wall)
  const box: Box = { x: -100, y: -100, width: 200, height: 200 }
  const edgeAt = dir > 0 ? 100 : -100
  const anchorAt = edgeAt - dir * 30
  const point: Point = axis === 'x' ? { x: anchorAt, y: 0 } : { x: 0, y: anchorAt }
  const [oLo, oHi] = [anchorAt + dir * 20, anchorAt + dir * 25].sort((a, b) => a - b)
  const obstacle: Box = axis === 'x' ? { x: oLo, y: -10, width: oHi - oLo, height: 20 } : { x: -10, y: oLo, width: 20, height: oHi - oLo }
  return { point, wall, box, clear: withObstacle ? [obstacle] : [] }
}

/** Far to the east of every `obstacleFixture` box, regardless of wall — a plain, obstacle-free `to` end so each
 * test below isolates the `from` end's own escape-walk behaviour. */
const farEastEnd: RouteEnd = { point: { x: 500, y: 0 }, wall: 'w', box: { x: 300, y: -100, width: 400, height: 200 }, clear: [] }

describe('routeLink — a sibling obstacle inside the escape band genuinely forces a jog, on every wall (REQ-LNK-05.1)', () => {
  const WALLS: Wall[] = ['e', 'w', 'ne', 'nw', 'se', 'sw']

  for (const wall of WALLS) {
    it(`wall '${wall}': the routed path detours around the obstacle instead of crossing it`, () => {
      const obstacle = obstacleFixture(wall, true)
      const { points: withObstacle } = routeLink(obstacle, farEastEnd)
      const { points: withoutObstacle } = routeLink(obstacleFixture(wall, false), farEastEnd)

      // Non-vacuous: the obstacle actually changed the route.
      expect(withObstacle).not.toEqual(withoutObstacle)
      // And it changed it by avoiding the obstacle, not by coincidence.
      for (let i = 1; i < withObstacle.length; i++) {
        expect(segmentPenetratesBox(withObstacle[i - 1], withObstacle[i], obstacle.clear[0])).toBe(false)
      }
    })
  }
})
