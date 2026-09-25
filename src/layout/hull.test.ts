import { describe, expect, it } from 'vitest'
import { contextRegions, pointInRegion } from './hull'
import { layoutMap } from './map'
import { parseHexa } from '../model/hexa'
import { neighbour, type Cell } from '../model/map'
import type { HexaMap } from '../model/schema'
import type { LayoutMode } from './layout'
import v2Honeycomb from '../model/fixtures/v2-honeycomb.hexa?raw'

const pitch = { x: 100, y: 80 }

describe('contextRegions (ADR-04)', () => {
  it('a split context draws as one entry with two disjoint outer loops', () => {
    const hexagons = [
      { cell: { q: 0, r: 0 }, contextId: 'c1' },
      { cell: { q: 5, r: 5 }, contextId: 'c1' },
    ]
    const regions = contextRegions(hexagons, pitch)
    const loops = regions.get('c1')!
    expect(loops).toHaveLength(2)
    // Each loop is its own closed hexagon: 6 vertices, none shared between the two loops.
    expect(loops[0]).toHaveLength(6)
    expect(loops[1]).toHaveLength(6)
    const keysOf = (loop: { x: number; y: number }[]) => new Set(loop.map((p) => `${p.x},${p.y}`))
    const shared = [...keysOf(loops[0])].some((k) => keysOf(loops[1]).has(k))
    expect(shared).toBe(false)
  })

  it('a ring of six around a foreign cell produces an outer loop and a hole loop, the foreign centre outside by evenodd', () => {
    const centre: Cell = { q: 0, r: 0 }
    const ring = (['e', 'se', 'sw', 'w', 'nw', 'ne'] as const).map((side) => neighbour(centre, side))
    const hexagons = [
      ...ring.map((c) => ({ cell: c, contextId: 'ring' })),
      { cell: centre, contextId: 'foreign' },
    ]
    const regions = contextRegions(hexagons, pitch)
    const loops = regions.get('ring')!
    expect(loops).toHaveLength(2)
    // The foreign cell's centre sits at the map origin — outside the ring's region (the hole), by evenodd.
    expect(pointInRegion({ x: 0, y: 0 }, loops)).toBe(false)
    // A point on the ring's own far side (well outside everything) is also outside.
    expect(pointInRegion({ x: 10_000, y: 10_000 }, loops)).toBe(false)
    const foreignLoops = regions.get('foreign')!
    expect(foreignLoops).toHaveLength(1)
    expect(pointInRegion({ x: 0, y: 0 }, foreignLoops)).toBe(true)
  })

  it('the honeycomb fixture shape (6-ring in one context, a split context of the foreign cell plus a far cell)', () => {
    const result = parseHexa(v2Honeycomb)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const hexagons = result.map.hexagons.map((h) => ({ cell: h.cell, contextId: h.contextId }))
    const regions = contextRegions(hexagons, pitch)
    // c1 ("Core"): the 6-ring around h7 — one outer loop, one hole loop.
    expect(regions.get('c1')).toHaveLength(2)
    // c2 (unnamed): h7 (inside the ring) and h8 (far away) — split, two outer loops.
    expect(regions.get('c2')).toHaveLength(2)
    expect(pointInRegion({ x: 0, y: 0 }, regions.get('c1')!)).toBe(false)
    expect(pointInRegion({ x: 0, y: 0 }, regions.get('c2')!)).toBe(true)
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
    version: 2,
    kind: 'hexagonal',
    title: `Seeded map ${seed}`,
    contexts: usedContexts.map((id) => ({ id })),
    hexagons: cells.map((c, i) => ({ id: `h${i + 1}`, contextId: contextIdOf[i], cell: c, title: '', ...emptyDiagram })),
    links: [],
  }
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
const MODES: LayoutMode[] = ['detailed', 'overview']

describe('contextRegions — property: enclosure and exclusion hold for random clusters', () => {
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
