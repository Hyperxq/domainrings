import { describe, expect, it } from 'vitest'
import { footprintRegions, pointInRegion } from './hull'
import { layoutMap } from './map'
import { chipBox } from './contextChips'
import { canvasBounds, contains } from '../ui/viewport'
import { neighbour, type Cell } from '../model/map'
import { VERSION, type HexaMap } from '../model/schema'
import type { LayoutMode } from './layout'

const hexOutline = (cx: number, cy: number, w = 26, h = 15, a = 30) =>
  [{ x: 0, y: -a }, { x: w, y: -h }, { x: w, y: h }, { x: 0, y: a }, { x: -w, y: h }, { x: -w, y: -h }].map((p) => ({ x: cx + p.x, y: cy + p.y }))
const member = (contextId: string, cell: Cell) => ({ cell, contextId, outline: hexOutline(100 * (cell.q + cell.r / 2), 87 * cell.r) })

describe('footprintRegions (ADR-04)', () => {
  it('a split context draws as one entry with two disjoint outer loops', () => {
    const loops = footprintRegions([member('c1', { q: 0, r: 0 }), member('c1', { q: 5, r: 5 })]).get('c1')!
    expect(loops).toHaveLength(2)
    expect(loops.map((l) => l.length)).toEqual([6, 6])
  })

  it('a ring of six around a foreign cell keeps the foreign centre outside the ring and inside its own region', () => {
    const centre: Cell = { q: 0, r: 0 }
    const ring = (['e', 'se', 'sw', 'w', 'nw', 'ne'] as const).map((side) => member('ring', neighbour(centre, side)))
    const regions = footprintRegions([...ring, member('foreign', centre)])
    expect(pointInRegion({ x: 0, y: 0 }, regions.get('ring')!)).toBe(false)
    expect(pointInRegion({ x: 0, y: 0 }, regions.get('foreign')!)).toBe(true)
  })

  it('neighbouring members merge into one loop that follows the hexagons, notch included', () => {
    const chain = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }].map((cell) => member('c1', cell))
    const loops = footprintRegions(chain).get('c1')!
    expect(loops).toHaveLength(1)
    expect(loops[0].length).toBeLessThan(30)
    for (const m of chain) expect(pointInRegion({ x: m.outline[0].x, y: m.outline[0].y + 10 }, loops)).toBe(true)
    // inside the convex hull of the three members, but in the notch their union leaves open
    expect(pointInRegion({ x: 50, y: 40 }, loops)).toBe(false)
  })
})

describe('footprintRegions where outlines touch', () => {
  const square = (x: number, y: number, size = 10) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }]
  const apart = (contextId: string, outline: { x: number; y: number }[], q: number) => ({ cell: { q, r: 0 }, contextId, outline })

  it.each([false, true])('two outlines sharing an edge merge into one loop with no seam left behind (swapped: %s)', (swapped) => {
    const pair = [apart('c1', square(0, 0), 0), apart('c1', square(10, 0), 5)]
    const loops = footprintRegions(swapped ? pair.reverse() : pair).get('c1')!
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(4)
    expect(pointInRegion({ x: 5, y: 5 }, loops)).toBe(true)
    expect(pointInRegion({ x: 15, y: 5 }, loops)).toBe(true)
    expect(Math.max(...loops[0].map((p) => p.x))).toBe(20)
  })

  it('outlines meeting at a single vertex keep both whole', () => {
    const loops = footprintRegions([apart('c1', square(0, 0), 0), apart('c1', square(10, 10), 5)]).get('c1')!
    expect(loops).toHaveLength(2)
    expect(loops.map((l) => l.length)).toEqual([4, 4])
  })

  it('an outline touched by a vertex on its side stays whole', () => {
    const triangle = [{ x: 10, y: 5 }, { x: 20, y: 0 }, { x: 20, y: 10 }]
    const loops = footprintRegions([apart('c1', square(0, 0), 0), apart('c1', triangle, 5)]).get('c1')!
    expect(loops.flat().length).toBeGreaterThanOrEqual(7)
    expect(pointInRegion({ x: 5, y: 5 }, loops)).toBe(true)
    expect(pointInRegion({ x: 18, y: 5 }, loops)).toBe(true)
  })
})

describe('footprintRegions with float hexagon coordinates', () => {
  const R = 33.3
  const W = (R * Math.sqrt(3)) / 2
  const hex = (cx: number, cy: number) =>
    [-90, -30, 30, 90, 150, 210].map((deg) => ({ x: cx + R * Math.cos((deg * Math.PI) / 180), y: cy + R * Math.sin((deg * Math.PI) / 180) }))
  const apart = (outline: { x: number; y: number }[], q: number) => ({ cell: { q, r: 0 }, contextId: 'c1', outline })
  const area = (loop: { x: number; y: number }[]) => Math.abs(loop.reduce((sum, p, i) => sum + p.x * loop[(i + 1) % loop.length].y - loop[(i + 1) % loop.length].x * p.y, 0) / 2)

  it.each([false, true])('two hexagons sharing a float edge merge into one 10-vertex loop (swapped: %s)', (swapped) => {
    const pair = [apart(hex(0.1, 0.3), 0), apart(hex(0.1 + 2 * W, 0.3), 5)]
    const loops = footprintRegions(swapped ? pair.reverse() : pair).get('c1')!
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(10)
    expect(area(loops[0])).toBeCloseTo(2 * area(hex(0, 0)), 3)
  })

  it.each([false, true])('three mutually touching hexagons merge into one loop (swapped: %s)', (swapped) => {
    const trio = [apart(hex(0, 0), 0), apart(hex(2 * W, 0), 5), apart(hex(W, 1.5 * R), 9)]
    const loops = footprintRegions(swapped ? trio.reverse() : trio).get('c1')!
    expect(loops).toHaveLength(1)
    expect(area(loops[0])).toBeCloseTo(3 * area(hex(0, 0)), 3)
  })

  // The crossing points sit on a 0.005 grid edge, so the two edges' float noise rounds to different vertex keys.
  const [a, b] = [(5 + 0.5) / 100 + 1, (36 + 0.5) / 100 + 1]
  const bar = [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: 10 }, { x: 0, y: 10 }]
  const slab = [{ x: a - 2, y: b - 1.5 }, { x: a + 2.74, y: b - 1.35 }, { x: a + 2.2, y: b + 1.5 }, { x: a - 1.4, y: b + 1.8 }]

  it('keeps closed loops and islands, and never covers a foreign centre, when a chain cannot close', () => {
    const foreign = { cell: { q: 3, r: 0 }, contextId: 'other', outline: [{ x: 1.4, y: 7.9 }, { x: 1.6, y: 7.9 }, { x: 1.6, y: 8.1 }, { x: 1.4, y: 8.1 }] }
    const loops = footprintRegions([apart(bar, 0), apart(slab, 1), apart(hex(500, 500), 9), foreign]).get('c1')!
    expect(pointInRegion({ x: 500, y: 500 }, loops)).toBe(true)
    expect(pointInRegion({ x: 1.5, y: 8 }, loops)).toBe(false)
    expect(pointInRegion({ x: 0.5, y: 9 }, loops)).toBe(true)
  })
})

describe('pointInRegion — evenodd point-in-polygon', () => {
  it('is true inside a single loop, false outside, false inside a hole', () => {
    const outer: { x: number; y: number }[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }]
    const hole: { x: number; y: number }[] = [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    expect(pointInRegion({ x: 0, y: 5 }, [outer, hole])).toBe(true)
    expect(pointInRegion({ x: 0, y: 0 }, [outer, hole])).toBe(false)
    expect(pointInRegion({ x: 100, y: 100 }, [outer, hole])).toBe(false)
  })
})

// --- Property test: a seeded generator grows a random cluster of cells, splits them across contexts, and checks
// the geometric enclosure guarantee ADR-04 proves — no dependency added, matching the design's "seeded in-repo
// generator" note. On failure, the `it` name carries the seed, so the exact failing map is reproducible.
function mulberry32(seed: number) {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WALLS = ['e', 'se', 'sw', 'w', 'nw', 'ne'] as const

function seededMap(seed: number): HexaMap {
  const rng = mulberry32(seed)
  const n = 2 + Math.floor(rng() * 29) // 2..30
  const contextCount = 2 + Math.floor(rng() * 2) // 2..3
  const cells: Cell[] = [{ q: 0, r: 0 }]
  const taken = new Set(['0,0'])
  while (cells.length < n) {
    const from = cells[Math.floor(rng() * cells.length)]
    const wall = WALLS[Math.floor(rng() * WALLS.length)]
    const at = neighbour(from, wall)
    const key = `${at.q},${at.r}`
    if (taken.has(key)) continue
    taken.add(key)
    cells.push(at)
  }
  const contextIds = Array.from({ length: contextCount }, (_, i) => `c${i + 1}`)
  const contextIdOf = cells.map(() => contextIds[Math.floor(rng() * contextCount)])
  const usedContexts = [...new Set(contextIdOf)]
  const emptyDiagram = { domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
  return {
    version: VERSION,
    kind: 'hexagonal',
    title: `Seeded map ${seed}`,
    contexts: usedContexts.map((id) => ({ id })),
    hexagons: cells.map((c, i) => ({ id: `h${i + 1}`, contextId: contextIdOf[i], cell: c, title: '', ...emptyDiagram })),
    links: [],
  }
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
const MODES: LayoutMode[] = ['detailed', 'overview']

describe('footprintRegions — property: enclosure and exclusion hold for random clusters', () => {
  for (const seed of SEEDS) {
    for (const mode of MODES) {
      it(`seed ${seed} (${mode}): every hexagon's outer ring lies inside its own region; no foreign centre lies inside it`, () => {
        const map = seededMap(seed)
        if (map.contexts.length < 2) return // the generator always picks 2-3 contexts, but guard defensively
        const model = layoutMap(map, { mode })
        expect(model.contexts.length).toBe(map.contexts.length)
        for (const region of model.contexts) {
          const own = model.hexagons.filter((h) => h.contextId === region.id)
          for (const hex of own) {
            const apex = hex.model.rings[0].apex
            const SQRT3 = Math.sqrt(3)
            const COS30 = SQRT3 / 2
            const unit = [{ x: 0, y: -1 }, { x: COS30, y: -0.5 }, { x: COS30, y: 0.5 }, { x: 0, y: 1 }, { x: -COS30, y: 0.5 }, { x: -COS30, y: -0.5 }]
            for (const v of unit) {
              const p = { x: hex.centre.x + v.x * apex, y: hex.centre.y + v.y * apex }
              expect(pointInRegion(p, region.loops)).toBe(true)
            }
          }
          const foreign = model.hexagons.filter((h) => h.contextId !== region.id)
          for (const hex of foreign) {
            expect(pointInRegion(hex.centre, region.loops)).toBe(false)
          }
        }
      })
    }
  }
})

describe('canvasBounds — the unscoped map export frame', () => {
  const pointBox = (p: { x: number; y: number }) => ({ ...p, width: 0, height: 0 })

  it.each(SEEDS)('seed %i: holds every context hull and chip', (seed) => {
    const model = layoutMap(seededMap(seed), { mode: 'overview' })
    const { x, y, width, height } = canvasBounds(model)
    const frame = { x: x - 1e-6, y: y - 1e-6, width: width + 2e-6, height: height + 2e-6 } // float slack
    for (const region of model.contexts) {
      for (const p of region.loops.flat()) expect(contains(frame, pointBox(p))).toBe(true)
      expect(contains(frame, chipBox(region.chip, region.label, region.size))).toBe(true)
    }
  })

  it('holds the outline of a single context', () => {
    const map = seededMap(3)
    const model = layoutMap({ ...map, contexts: [{ id: 'c1' }], hexagons: map.hexagons.map((h) => ({ ...h, contextId: 'c1' })) }, { mode: 'overview' })
    expect(model.outline).toBeDefined()
    for (const p of model.outline!.flat()) expect(contains(canvasBounds(model), pointBox(p))).toBe(true)
  })
})
