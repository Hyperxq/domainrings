import { describe, expect, it } from 'vitest'
import { cellCentre, hexagonBounds, layoutMap, MAP_GAP } from './map'
import { layoutDiagram, type LayoutMode } from './layout'
import { toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM } from '../model/example'
import type { Diagram, HexaMap } from '../model/schema'
import { twoHexagonMap } from '../test/fixtures'

const CORPUS: Array<[string, Diagram]> = [
  ['the seeded example', EXAMPLE_DIAGRAM],
  ['the stress diagram', STRESS_DIAGRAM],
  ...RETIRED_SEEDS.map((seed, i): [string, Diagram] => [`retired seed v${i + 1}`, seed]),
]
const MODES: LayoutMode[] = ['detailed', 'overview']

describe('layoutMap — one-hexagon equivalence (MIG-05)', () => {
  for (const mode of MODES) {
    for (const [label, diagram] of CORPUS) {
      it(`matches layoutDiagram for ${label} in ${mode} mode`, () => {
        const map = toMap(diagram)
        const result = layoutMap(map, { mode })
        const expected = layoutDiagram(diagram, { mode })
        expect(result.hexagons).toHaveLength(1)
        expect(result.hexagons[0].model).toStrictEqual(expected)
        expect(result.hexagons[0].centre).toStrictEqual({ x: 0, y: 0 })
        expect(result.bounds).toStrictEqual(expected.bounds)
        expect(result.title).toBeUndefined()
        expect(result.links).toEqual([])
      })
    }
  }
})

describe('layoutMap — multi-hexagon placement (CANVAS-01, CANVAS-02)', () => {
  it('places two hexagons on a row without overlapping shifted bounds', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.hexagons).toHaveLength(2)
    const [a, b] = result.hexagons
    expect(a.centre).toStrictEqual({ x: 0, y: 0 })
    expect(b.centre.x).toBeGreaterThan(0)
    const boxA = { left: a.model.bounds.x + a.centre.x, right: a.model.bounds.x + a.centre.x + a.model.bounds.width }
    const boxB = { left: b.model.bounds.x + b.centre.x, right: b.model.bounds.x + b.centre.x + b.model.bounds.width }
    expect(boxA.right).toBeLessThan(boxB.left)
  })

  it('renders a map title only when there is more than one hexagon', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.title).toMatchObject({ text: 'Two slices, one link', style: 'title' })
  })

  it('never overlaps two lopsided hexagons — one whose content reaches far right, the other far left (CANVAS-01.1)', () => {
    // h1's driven external stretches its content to the RIGHT of its own centre; h2's driving actor stretches
    // its content to the LEFT of its own centre — the exact combination a uniform pitch (based on width alone)
    // cannot space correctly, since it ignores which side each hexagon's extent actually falls on.
    const map: HexaMap = {
      version: 2,
      kind: 'hexagonal',
      title: 'Lopsided pair',
      contexts: [{ id: 'c1' }],
      hexagons: [
        {
          id: 'h1',
          contextId: 'c1',
          cell: { q: 0, r: 0 },
          title: 'Right heavy',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-drv', name: 'drv', side: 'driven' }],
          adapters: [{ id: 'a1', name: 'Adapter', portId: 'p-drv' }],
          actors: [],
          externals: [{ id: 'e1', name: 'A Very Long External System Name That Extends Far To The Right', adapterId: 'a1' }],
        },
        {
          id: 'h2',
          contextId: 'c1',
          cell: { q: 1, r: 0 },
          title: 'Left heavy',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-drg', name: 'drg', side: 'driving' }],
          adapters: [{ id: 'a2', name: 'Adapter', portId: 'p-drg' }],
          actors: [{ id: 'ac1', name: 'A Very Long Actor Name That Extends Far To The Left', adapterId: 'a2' }],
          externals: [],
        },
      ],
      links: [],
    }

    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const boxA = { left: a.model.bounds.x + a.centre.x, right: a.model.bounds.x + a.centre.x + a.model.bounds.width }
    const boxB = { left: b.model.bounds.x + b.centre.x, right: b.model.bounds.x + b.centre.x + b.model.bounds.width }
    expect(boxB.left - boxA.right).toBeGreaterThanOrEqual(MAP_GAP)
  })

  it('draws the link as one segment between the from port and the to port', () => {
    const map = twoHexagonMap()
    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const outNode = a.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-out')!
    const inNode = b.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-in')!
    expect(result.links).toEqual([
      {
        id: 'l1',
        points: [
          { x: outNode.x + a.centre.x, y: outNode.y + a.centre.y },
          { x: inNode.x + b.centre.x, y: inNode.y + b.centre.y },
        ],
      },
    ])
  })
})

describe('cellCentre — affine pointy-top lattice (ADR-01)', () => {
  const pitch = { x: 100, y: 80 }

  it('places {0,0} at the origin regardless of pitch', () => {
    expect(cellCentre({ q: 0, r: 0 }, pitch)).toStrictEqual({ x: 0, y: 0 })
  })

  it('steps by pitch.x along q, with no y movement', () => {
    expect(cellCentre({ q: 2, r: 0 }, pitch)).toStrictEqual({ x: 200, y: 0 })
  })

  it('steps by pitch.y along r, skewing x by half a step per r — a pointy-top lattice, not a rectangular grid', () => {
    expect(cellCentre({ q: 0, r: 1 }, pitch)).toStrictEqual({ x: 50, y: 80 })
    expect(cellCentre({ q: 0, r: -2 }, pitch)).toStrictEqual({ x: -100, y: -160 })
  })
})

describe('layoutMap — honeycomb lattice placement (ADR-01)', () => {
  const twoCellColumn = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Two on a column',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'North', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 0, r: 1 }, title: 'South', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
    links: [],
  })

  it('derives pitch from the map’s own max extents + MAP_GAP and places {0,1} at half a pitch.x, one pitch.y down', () => {
    const result = layoutMap(twoCellColumn())
    const [a, b] = result.hexagons
    // Both hexagons share the same (empty) content, so either model's bounds already are the map's max extents.
    // Expected values are literal arithmetic on that independently-derived pitch, never calling cellCentre —
    // otherwise a mutation to cellCentre's own formula would cancel out on both sides of the assertion.
    const left = -a.model.bounds.x
    const right = a.model.bounds.x + a.model.bounds.width
    const top = -a.model.bounds.y
    const bottom = a.model.bounds.y + a.model.bounds.height
    const pitchX = left + right + MAP_GAP
    const pitchY = top + bottom + MAP_GAP
    expect(a.centre).toStrictEqual({ x: 0, y: 0 })
    expect(b.centre).toStrictEqual({ x: pitchX * 0.5, y: pitchY })
  })

  it('keeps the two boxes disjoint by at least MAP_GAP', () => {
    const result = layoutMap(twoCellColumn())
    const [a, b] = result.hexagons
    const boxA = hexagonBounds(a)
    const boxB = hexagonBounds(b)
    expect(boxB.y - (boxA.y + boxA.height)).toBeGreaterThanOrEqual(MAP_GAP)
  })

  it('exposes the pitch it computed, so a caller can place a not-yet-existing neighbour cell (SEAM-04)', () => {
    const result = layoutMap(twoCellColumn())
    const [, b] = result.hexagons
    // b sits at cell {0,1} = cellCentre({0,1}, pitch); reading the pitch back off that relation, independent of cellCentre itself.
    expect(result.pitch).toStrictEqual({ x: b.centre.x * 2, y: b.centre.y })
  })

  // Hardening for a coverage gap verify-in-loop-1 flagged: the two prior tests use hexagons with IDENTICAL
  // (empty) content, so a pitch computed from `perHexagon[0]`'s extents alone happens to match `Math.max(...)`
  // over every hexagon — neither test can tell the two implementations apart. Here h1 (first in the array) is
  // tiny and h2 is STRESS-sized, so a first-hexagon-only pitch would be far too small and the boxes would overlap.
  it('derives pitch from the map-wide max extents, not the first hexagon’s own (CANVAS-01.4 hardening)', () => {
    const map: HexaMap = {
      version: 2,
      kind: 'hexagonal',
      title: 'Small then stress',
      contexts: [{ id: 'c1' }],
      hexagons: [
        { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'Small', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
        {
          id: 'h2',
          contextId: 'c1',
          cell: { q: 1, r: 0 },
          title: STRESS_DIAGRAM.title,
          domain: STRESS_DIAGRAM.domain,
          useCases: STRESS_DIAGRAM.useCases,
          ports: STRESS_DIAGRAM.ports,
          adapters: STRESS_DIAGRAM.adapters,
          actors: STRESS_DIAGRAM.actors,
          externals: STRESS_DIAGRAM.externals,
        },
      ],
      links: [],
    }
    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const boxA = hexagonBounds(a)
    const boxB = hexagonBounds(b)
    expect(boxB.x - (boxA.x + boxA.width)).toBeGreaterThanOrEqual(MAP_GAP)
  })
})

describe('layoutMap — contexts (CB-01.1, ADR-04, SEAM-04)', () => {
  const oneContextMap = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'One context',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'A', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 1, r: 0 }, title: 'B', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
    links: [],
  })

  const twoContextMap = (): HexaMap => ({
    ...oneContextMap(),
    contexts: [{ id: 'c1', name: 'Billing' }, { id: 'c2' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'A', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c2', cell: { q: 6, r: 6 }, title: 'B', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
  })

  it('exposes no contexts below two (CB-01.1)', () => {
    const result = layoutMap(oneContextMap())
    expect(result.contexts).toEqual([])
  })

  it('exposes one entry per context, with its display label, from two contexts up', () => {
    const result = layoutMap(twoContextMap())
    expect(result.contexts.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(result.contexts.find((c) => c.id === 'c1')?.label).toBe('Billing')
    expect(result.contexts.find((c) => c.id === 'c2')?.label).toBe('Context 2')
    for (const c of result.contexts) expect(c.loops.length).toBeGreaterThan(0)
  })

  it('grows bounds to include the hull loops and chips once contexts are drawn', () => {
    const withoutContexts = layoutMap(oneContextMap())
    const withContexts = layoutMap(twoContextMap())
    // h2 sits at a distant cell {6,6} — its hull loop and chip push the bounds far beyond the two close hexagons alone.
    expect(withContexts.bounds.width).toBeGreaterThan(withoutContexts.bounds.width * 3)
  })
})
