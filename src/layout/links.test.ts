import { describe, expect, it } from 'vitest'
import { arcLengthMidpoint, routeLink, type RouteEnd } from './links'
import type { Box, Point } from './layout'
import { hexagonBounds, layoutMap } from './map'
import { freeCell } from '../model/map'
import type { HexaMap, Hexagon } from '../model/schema'

describe('routeLink — boxes separated on X (side by side)', () => {
  it('crosses via the gap’s own midline: [portA, portA-on-midline, portB-on-midline, portB]', () => {
    const from: RouteEnd = { point: { x: 50, y: -10 }, box: { x: -50, y: -50, width: 100, height: 100 } }
    const to: RouteEnd = { point: { x: 250, y: 20 }, box: { x: 250, y: -50, width: 100, height: 100 } }

    const path = routeLink(from, to)

    expect(path).toEqual([
      { x: 50, y: -10 },
      { x: 150, y: -10 },
      { x: 150, y: 20 },
      { x: 250, y: 20 },
    ])
    // The midline sits strictly between the two boxes — outside both regardless of y (REQ-LNK-05.1).
    expect(path[1].x).toBeGreaterThan(from.box.x + from.box.width)
    expect(path[1].x).toBeLessThan(to.box.x)
  })

  it('collapses to a straight line when both ports sit at the same height', () => {
    const from: RouteEnd = { point: { x: 50, y: 0 }, box: { x: -50, y: -50, width: 100, height: 100 } }
    const to: RouteEnd = { point: { x: 250, y: 0 }, box: { x: 250, y: -50, width: 100, height: 100 } }

    expect(routeLink(from, to)).toEqual([
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 0 },
      { x: 250, y: 0 },
    ])
  })
})

describe('routeLink — boxes separated on Y (stacked, not side by side)', () => {
  it('picks the Y midline when that is the axis the two boxes are actually apart on', () => {
    const from: RouteEnd = { point: { x: -50, y: -100 }, box: { x: -50, y: -150, width: 100, height: 100 } }
    const to: RouteEnd = { point: { x: -40, y: 100 }, box: { x: -40, y: 50, width: 100, height: 100 } }

    const path = routeLink(from, to)

    expect(path).toEqual([
      { x: -50, y: -100 },
      { x: -50, y: 0 },
      { x: -40, y: 0 },
      { x: -40, y: 100 },
    ])
    expect(path[1].y).toBeGreaterThan(from.box.y + from.box.height)
    expect(path[1].y).toBeLessThan(to.box.y)
  })
})

describe('arcLengthMidpoint', () => {
  it('is the endpoint of a single-segment path with zero length', () => {
    expect(arcLengthMidpoint([{ x: 10, y: 10 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 10 })
  })

  it('sits halfway along a straight two-point path', () => {
    expect(arcLengthMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 })
  })

  it('sits halfway along the total length of a multi-segment path, not halfway by point count', () => {
    // Total length 10 + 100 = 110; the midpoint (55) falls 45 units into the second, longer segment.
    const points: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 110, y: 0 }]
    expect(arcLengthMidpoint(points)).toEqual({ x: 55, y: 0 })
  })
})

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
 * carrying one port each — a driven port on one, a driving port on the other — joined by a link. */
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

/** Liang-Barsky clip of segment `p1→p2` against `box`; `null` when the segment never enters it, otherwise the
 * [t0, t1] sub-range (in the segment's own 0..1 parametrisation) that lies inside. */
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

/** Whether the segment truly PENETRATES the box's interior — a clip range of positive length, not just a single
 * touching point (which is exactly what a port's own boundary point produces). */
function segmentPenetratesBox(p1: Point, p2: Point, box: Box, epsilon = 1e-6): boolean {
  const clip = clipToBox(p1, p2, box)
  return clip !== null && clip[1] - clip[0] > epsilon
}

/**
 * Whether the route penetrates either of its OWN two endpoint hexagons' boxes, outside the one unavoidable
 * crossing each end makes of its own box: the very first segment (port → onMidline) necessarily leaves box A from
 * inside it — a port sits inside its own box's rectangle, not always on its edge, so that segment is exempted
 * from the box-A check (and mirrored for the last segment, box B). Every other segment — the whole middle of the
 * channel — must clear both boxes (REQ-LNK-05.1).
 */
function linkPenetratesOwnBoxes(points: Point[], boxA: Box, boxB: Box): boolean {
  for (let i = 1; i < points.length; i++) {
    const [p1, p2] = [points[i - 1], points[i]]
    const isFirst = i === 1
    const isLast = i === points.length - 1
    if (!isFirst && segmentPenetratesBox(p1, p2, boxA)) return true
    if (!isLast && segmentPenetratesBox(p1, p2, boxB)) return true
  }
  return false
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const SIZES = [2, 5, 12, 30]

describe('layoutMap — routed links never cross the body of either of their own two endpoint hexagons (REQ-LNK-05.1)', () => {
  for (const seed of SEEDS) {
    for (const n of SIZES) {
      it(`seed ${seed}, N=${n}: the routed link clears both its own endpoint boxes`, () => {
        const map = seededLinkedMap(seed, n)
        const result = layoutMap(map)
        const link = result.links[0]
        const fromHex = result.hexagons.find((h) => h.id === map.links[0].from.hexagonId)!
        const toHex = result.hexagons.find((h) => h.id === map.links[0].to.hexagonId)!

        expect(linkPenetratesOwnBoxes(link.points, hexagonBounds(fromHex), hexagonBounds(toHex))).toBe(false)
      })
    }
  }
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
