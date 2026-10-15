import { describe, expect, it } from 'vitest'
import type { Wall } from '../../model/schema'
import { dot, type Point } from '../geometry'
import { COS30 } from '../outline'
import { around, arcBetween, hexHit, minimiseCrossings, overlap, routeTracks, wallAt, type Placed } from './corridors'
import { TRACK_GAP } from './spacing'
import { VERTEX, wallFrame } from './walls'

const ALL: Wall[] = ['e', 'se', 'sw', 'w', 'nw', 'ne']
/** How far a point is from the centre along the hexagon's own normals: the apothem of the hexagon it lies on. */
const apothemOf = (p: Point) => Math.max(...ALL.map((w) => dot(p, wallFrame(w).n)))
const at = (wall: Wall, depth: number, u: number): Point => {
  const { n, dir } = wallFrame(wall)
  return { x: n.x * depth + dir.x * u, y: n.y * depth + dir.y * u }
}
const placed = (wall: Wall, depth: number, u: number, width = 80, height = 40): Placed => ({ ...at(wall, depth, u), width, height, wall })

const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const crosses = (p: Point[], q: Point[]) => {
  let n = 0
  for (let i = 1; i < p.length; i++)
    for (let j = 1; j < q.length; j++) {
      const [d1, d2, d3, d4] = [orientation(p[i - 1], p[i], q[j - 1]), orientation(p[i - 1], p[i], q[j]), orientation(q[j - 1], q[j], p[i - 1]), orientation(q[j - 1], q[j], p[i])]
      if (d1 * d2 < -1e-9 && d3 * d4 < -1e-9) n++
    }
  return n
}

describe('overlap', () => {
  it('is the stretch both boxes reach along the wall, kept 4 off either end', () => {
    expect(overlap({ u: 0, reach: 20 }, { u: 10, reach: 20 })).toEqual([-6, 16])
  })

  it('is undefined when the boxes do not meet', () => {
    expect(overlap({ u: 0, reach: 10 }, { u: 40, reach: 10 })).toBeUndefined()
    expect(overlap({ u: 0, reach: 10 }, { u: 16, reach: 10 })).toBeUndefined()
  })
})

describe('arcBetween', () => {
  it('goes the shorter way round, counted in walls', () => {
    expect(arcBetween('e', 'se')).toEqual({ clockwise: true, vertices: [2] })
    expect(arcBetween('e', 'ne')).toEqual({ clockwise: false, vertices: [1] })
    expect(arcBetween('se', 'w')).toEqual({ clockwise: true, vertices: [3, 4] })
  })

  it('passes no vertex between a wall and itself', () => {
    expect(arcBetween('nw', 'nw').vertices).toEqual([])
  })

  it('keeps clear of the top vertex, where the title is, when both ways are as short', () => {
    expect(arcBetween('w', 'e').vertices).toEqual([4, 3, 2])
    expect(arcBetween('e', 'w').vertices).toEqual([2, 3, 4])
    expect(arcBetween('sw', 'ne').vertices.includes(0)).toBe(false)
    expect(arcBetween('ne', 'sw').vertices.includes(0)).toBe(false)
  })

  it('is the same walk in reverse', () => {
    for (const a of ALL) for (const b of ALL) expect(arcBetween(a, b).vertices).toEqual([...arcBetween(b, a).vertices].reverse())
  })
})

describe('wallAt', () => {
  it('names the wall a point faces', () => {
    for (const w of ALL) expect(wallAt(at(w, 100, 10))).toBe(w)
  })
})

describe('hexHit', () => {
  it('meets the hexagon straight in from outside', () => {
    expect(hexHit({ x: 300, y: 0 }, { x: -1, y: 0 }, 100)).toEqual({ x: 100, y: 0 })
  })

  it('meets the hexagon straight out from inside along a slanted normal', () => {
    for (const w of ALL) {
      const { n } = wallFrame(w)
      const hit = hexHit(at(w, 60, 5), n, 100)
      expect(apothemOf(hit)).toBeCloseTo(100, 6)
      expect(hit.x - at(w, 60, 5).x).toBeCloseTo(n.x * 40, 6)
    }
  })

  it('lands on the neighbouring wall when the hop starts past the end of its own', () => {
    const start = at('e', 200, 80)
    const hit = hexHit(start, { x: -1, y: 0 }, 100)
    expect(apothemOf(hit)).toBeCloseTo(100, 6)
    expect(wallAt(hit)).toBe('se')
    expect(hit.y).toBe(start.y)
    expect(hit.x).toBeCloseTo((100 / COS30 - 80) * Math.sqrt(3), 6)
  })
})

describe('hexHit from outside, pointing away', () => {
  it('returns the near side of the hexagon, never the far one', () => {
    expect(hexHit({ x: 300, y: 0 }, { x: 1, y: 0 }, 100)).toEqual({ x: 100, y: 0 })
    for (const w of ALL) {
      const { n } = wallFrame(w)
      const start = at(w, 300, 5)
      const hit = hexHit(start, n, 100)
      expect(apothemOf(hit)).toBeCloseTo(100, 6)
      expect(wallAt(hit)).toBe(w)
      expect(Math.hypot(hit.x - start.x, hit.y - start.y)).toBeLessThan(250)
    }
  })

  it('stays where it is when the line misses the hexagon', () => {
    expect(hexHit({ x: 300, y: 300 }, { x: 1, y: 0 }, 100)).toEqual({ x: 300, y: 300 })
    expect(hexHit({ x: 300, y: 300 }, { x: -1, y: 0 }, 100)).toEqual({ x: 300, y: 300 })
  })

  it('meets the near wall when it starts outside and points in', () => {
    for (const w of ALL) {
      const { n } = wallFrame(w)
      const start = at(w, 300, 5)
      const hit = hexHit(start, { x: -n.x, y: -n.y }, 100)
      expect(wallAt(hit)).toBe(w)
      expect(Math.hypot(hit.x - start.x, hit.y - start.y)).toBeCloseTo(200, 6)
    }
  })
})

describe('a run up a vertical wall', () => {
  const apothem = 504.7313231888889

  it('is exactly vertical from the hop to the corner', () => {
    for (const x of [-1, 1]) {
      const hop = hexHit({ x: x * 548.4586187818952, y: 0 }, { x: -x, y: 0 }, apothem)
      const [corner] = around(x < 0 ? 'w' : 'e', x < 0 ? 'nw' : 'ne', apothem, Infinity)
      expect(hop.x).toBe(x * apothem)
      expect(corner.x).toBe(x * apothem)
    }
  })
})

describe('around', () => {
  const r = 100 / COS30

  it('lists the corners of the hexagon passed on the way', () => {
    expect(around('e', 'sw', 100, 1e9)).toEqual([VERTEX[2], VERTEX[3]].map((v) => ({ x: v.x * r, y: v.y * r })))
  })

  it('ducks under the top corner, where the title is', () => {
    const [left, right] = around('nw', 'ne', 100, 60)
    expect([left.y, right.y]).toEqual([-60, -60])
    expect(left.x).toBeCloseTo(-(r - 60) * Math.sqrt(3), 6)
    expect(right.x).toBeCloseTo((r - 60) * Math.sqrt(3), 6)
    expect(around('ne', 'nw', 100, 60)[0].x).toBeGreaterThan(0)
  })

  it('keeps the corner when the duck line is no deeper than it', () => {
    expect(around('nw', 'ne', 100, r + 5)).toEqual([{ x: 0, y: -r }])
  })
})

describe('minimiseCrossings', () => {
  it('puts first the track that must run outside', () => {
    // cost[i][j]: crossings when i runs outside j
    expect(minimiseCrossings([[0, 1], [0, 0]])).toEqual([1, 0])
    expect(minimiseCrossings([[0, 0], [1, 0]])).toEqual([0, 1])
  })

  it('finds the cheapest of all orders, not the first that is free of conflicts', () => {
    const cost = [
      [0, 5, 0],
      [0, 0, 5],
      [5, 0, 0],
    ]
    const order = minimiseCrossings(cost)
    const total = order.reduce((sum, i, k) => sum + order.slice(k + 1).reduce((s, j) => s + cost[i][j], 0), 0)
    expect(total).toBe(5)
  })

  it('still orders more tracks than it can search exhaustively', () => {
    const cost = Array.from({ length: 20 }, (_, i) => Array.from({ length: 20 }, (_, j) => (i < j ? 1 : 0)))
    expect(minimiseCrossings(cost)).toEqual(Array.from({ length: 20 }, (_, i) => 19 - i))
  })
})

describe('routeTracks', () => {
  const outer = 260
  const geometry = { outer }
  const port = (wall: Wall, u: number) => placed(wall, 300, u, 60, 50)
  const seat = (wall: Wall, u: number, depth = 150) => placed(wall, depth, u, 120, 50)

  it('runs a straight hop where the port and its use case overlap on one wall', () => {
    const [path] = routeTracks([{ port: port('e', 0), useCase: seat('e', 5) }], geometry)
    expect(path).toHaveLength(2)
    expect(path[0].y).toBe(path[1].y)
  })

  it('leaves the port square to its wall, runs round the corridor and enters the use case square to its wall', () => {
    const [path] = routeTracks([{ port: port('w', 0), useCase: seat('e', 0) }], geometry)
    const [first, second, penultimate, last] = [path[0], path[1], path.at(-2)!, path.at(-1)!]
    expect(dot({ x: second.x - first.x, y: second.y - first.y }, wallFrame('w').dir)).toBeCloseTo(0, 6)
    expect(dot({ x: last.x - penultimate.x, y: last.y - penultimate.y }, wallFrame('e').dir)).toBeCloseTo(0, 6)
    expect(path.slice(1, -1).every((p) => Math.abs(apothemOf(p) - outer) < 1e-6)).toBe(true)
  })

  it('gives links sharing a stretch of the corridor parallel tracks a gap apart', () => {
    const paths = routeTracks(
      [
        { port: port('w', -60), useCase: seat('e', -60) },
        { port: port('w', 60), useCase: seat('e', 60) },
        { port: port('sw', 0), useCase: seat('se', 0) },
      ],
      geometry,
    )
    const tracks = paths.map((p) => apothemOf(p[1]))
    expect([...tracks].sort((a, b) => b - a).map((t, i, all) => (i ? all[i - 1] - t : TRACK_GAP))).toEqual([TRACK_GAP, TRACK_GAP, TRACK_GAP])
  })

  const nested = [
    { port: port('w', 60), useCase: seat('e', 60) },
    { port: port('w', -60), useCase: seat('e', -60) },
  ]

  it('orders the tracks so that no hop crosses another run, whatever order the links come in', () => {
    for (const requests of [nested, [...nested].reverse()]) {
      const paths = routeTracks(requests, geometry)
      expect(crosses(paths[0], paths[1])).toBe(0)
    }
  })

  it('does not depend on the order the links come in', () => {
    const forward = routeTracks(nested, geometry)
    const backward = routeTracks([...nested].reverse(), geometry).reverse()
    expect(backward).toEqual(forward)
  })

  it('spreads the links arriving at one use case along its face', () => {
    const useCase = seat('e', 0)
    const paths = routeTracks([{ port: port('w', 0), useCase }, { port: port('sw', 0), useCase }, { port: port('nw', 0), useCase }], geometry)
    const entries = paths.map((p) => p.at(-1)!.y).sort((a, b) => a - b)
    expect(entries[1] - entries[0]).toBeGreaterThanOrEqual(TRACK_GAP - 1e-9)
    expect(entries[2] - entries[1]).toBeGreaterThanOrEqual(TRACK_GAP - 1e-9)
  })

  it('still routes a use case on the same wall as a port it does not overlap', () => {
    const [path] = routeTracks([{ port: port('e', -150), useCase: seat('e', 100) }], geometry)
    expect(path.length).toBeGreaterThan(2)
    expect(path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('keeps every entry on the face when straight runs sit within a track gap of either end', () => {
    const useCase = seat('e', 0)
    const straight = [port('e', -17), port('e', 17)]
    const paths = routeTracks([...straight, port('nw', 0), port('sw', 0), port('w', 0)].map((p) => ({ port: p, useCase })), geometry)
    const [lo, hi] = [useCase.y - useCase.height / 2 + 4, useCase.y + useCase.height / 2 - 4]
    for (const p of paths) expect(p.at(-1)!.y, `${p.length} points`).toBeGreaterThanOrEqual(lo - 1e-9)
    for (const p of paths) expect(p.at(-1)!.y).toBeLessThanOrEqual(hi + 1e-9)
    const [low, high] = [paths[0].at(-1)!.y, paths[1].at(-1)!.y]
    for (const p of paths.slice(2)) expect(p.at(-1)!.y <= low || p.at(-1)!.y >= high).toBe(true)
  })

  it('routes nothing for no links', () => {
    expect(routeTracks([], geometry)).toEqual([])
  })
})
